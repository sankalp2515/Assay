import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Context } from "../core/context.js";
import { endpoint } from "../core/http.js";
import { requireThat } from "../core/errors.js";
import { uuid, type Json } from "../domain/contracts.js";

// Read-only views for the operator UI: a per-batch timeline (shaped for a resource
// scheduler: resources and events) and a cross-batch operations table. Every event says
// whether it was OBSERVED in Assay's records or is an ESTIMATE (for example, when a
// provider will delete its copy, from that provider's published retention).
const HOUR = 3600_000;
// Published provider output retention, lower bound. Reported providers: unknown.
const PROVIDER_RETENTION_MS: Record<string, number | null> = {
  replicate: 1 * HOUR, // replicate.com/docs/topics/predictions/data-retention
  runway: 24 * HOUR, // docs.dev.runwayml.com/assets/outputs (24-48 h)
  reported: null,
};
// PayPal: an authorization can be captured for 29 days; funds are honored for 3.
const HONOR_MS = 3 * 24 * HOUR;
const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const plus = (v: string | null, ms: number) => (v ? new Date(Date.parse(v) + ms).toISOString() : null);

type Ev = {
  id: string;
  resourceId: string;
  name: string;
  kind: string;
  startDate: string;
  endDate: string | null;
  basis: "OBSERVED" | "ESTIMATE";
  note?: string;
};

export function viewRoutes(app: FastifyInstance, ctx: Context) {
  async function gather(tenant: string, batchId: string) {
    const batch = await ctx.db.get<Json>(tenant, "batch", batchId);
    requireThat(batch, "not_found", "Batch not found", 404);
    // A read that fails is reported as unavailable, never shown as an empty or zero value.
    const unavailable: string[] = [];
    const soft = async <T>(name: string, f: () => Promise<T>, fallback: T) => {
      try {
        return await f();
      } catch {
        unavailable.push(name);
        return fallback;
      }
    };
    const [attempts, artifacts, auth, ops, disputes, playback, recoveries] = await Promise.all([
      soft("attempts", async () => ((await ctx.call("provider", "/internal/batches/" + batchId + "/attempts", tenant)).attempts as Json[]), []),
      soft("artifacts", async () => ((await ctx.call("delivery", "/internal/batches/" + batchId + "/artifacts", tenant)).artifacts as Json[]), []),
      soft("authorization", async () => await ctx.call("payments", "/internal/batches/" + batchId + "/authorization", tenant), null as Json | null),
      soft("operations", async () => ((await ctx.call("payments", "/internal/batches/" + batchId + "/operations", tenant)).operations as Json[]), []),
      soft("disputes", async () => ((await ctx.call("payments", "/internal/batches/" + batchId + "/disputes", tenant)).disputes as Json[]), []),
      soft("playback", async () => ((await ctx.call("delivery", "/internal/batches/" + batchId + "/playback", tenant)).probes as Json[]), []),
      ctx.db.list<Json>(tenant, "recovery", batchId),
    ]);
    return { batch, attempts, artifacts, auth, ops, disputes, playback, recoveries, unavailable };
  }

  endpoint(app, ctx, "GET", "/v1/batches/:batch/timeline", ["operator"], ["operator", "integration"], async (a, _b, p) => {
    const g = await gather(a.tenant, uuid.parse(p.batch));
    const units = (g.batch.units as { id: string }[]) ?? [];
    const resources = [
      { id: "paypal", name: "PayPal", kind: "payment" },
      ...units.map((u, i) => ({ id: u.id, name: "Clip " + (i + 1), kind: "clip" })),
      ...(g.disputes.length ? [{ id: "disputes", name: "Disputes", kind: "dispute" }] : []),
    ];
    const events: Ev[] = [];
    const add = (e: Omit<Ev, "id">) => {
      if (e.startDate) events.push({ id: e.resourceId + ":" + e.kind + ":" + events.length, ...e });
    };
    const authorized = iso(g.auth?.confirmed_at);
    if (authorized) {
      add({ resourceId: "paypal", name: "Hold honored by PayPal", kind: "authorization_honor", startDate: authorized, endDate: plus(authorized, HONOR_MS), basis: "ESTIMATE", note: "PayPal honors authorized funds for 3 days" });
      add({ resourceId: "paypal", name: "Hold can be captured until", kind: "authorization_validity", startDate: authorized, endDate: iso(g.auth?.expires_at), basis: "OBSERVED" });
    }
    add({ resourceId: "paypal", name: "Batch deadline", kind: "batch_window", startDate: iso(g.batch.created_at)!, endDate: iso(g.batch.deadline), basis: "OBSERVED" });
    for (const op of g.ops)
      if (op.state === "CONFIRMED" && iso(op.confirmed_at))
        add({ resourceId: "paypal", name: op.kind === "CAPTURE" ? "Captured" : op.kind === "VOID" ? "Hold released" : "Refunded", kind: String(op.kind).toLowerCase(), startDate: iso(op.confirmed_at)!, endDate: null, basis: "OBSERVED" });
    for (const at of g.attempts) {
      const start = iso(at.created_at);
      if (!start) continue;
      const source = String(at.source ?? "runway");
      add({ resourceId: String(at.unit_id), name: "Task registered (" + source + ")", kind: "task", startDate: start, endDate: null, basis: "OBSERVED" });
      const keep = PROVIDER_RETENTION_MS[source];
      if (keep)
        add({ resourceId: String(at.unit_id), name: "Provider keeps output", kind: "provider_retention", startDate: start, endDate: plus(start, keep), basis: "ESTIMATE", note: "Lower bound of the provider's published retention, from registration" });
    }
    for (const art of g.artifacts) {
      const stored = iso(art.stored_at);
      if (stored)
        add({ resourceId: String(art.unit_id), name: "Original archived by Assay", kind: "archive", startDate: stored, endDate: iso(art.retention_until), basis: "OBSERVED" });
      const published = iso(art.published_at);
      if (published)
        add({ resourceId: String(art.unit_id), name: "Buyer can open", kind: "retrievable", startDate: published, endDate: iso(art.retention_until), basis: "OBSERVED" });
    }
    for (const r of g.recoveries)
      add({ resourceId: String(r.unit_id), name: "Recovered instead of re-rendered", kind: "recovery", startDate: iso(r.recovered_at)!, endDate: null, basis: "OBSERVED" });
    for (const pr of g.playback)
      if (iso(pr.probed_at))
        add({ resourceId: String(pr.unit_id), name: "External playback: " + String(pr.outcome), kind: "playback", startDate: iso(pr.probed_at)!, endDate: null, basis: "OBSERVED" });
    for (const d of g.disputes)
      add({ resourceId: "disputes", name: "Dispute " + String(d.status), kind: "dispute", startDate: iso(d.first_seen_at) ?? iso(d.read_back_at)!, endDate: iso(d.seller_response_due_date), basis: "OBSERVED", note: "Ends at PayPal's seller response deadline" });
    const at_risk = units
      .filter((u) => {
        const archived = g.artifacts.some((x) => x.unit_id === u.id && x.state === "STORED");
        const keep = events.find((e) => e.resourceId === u.id && e.kind === "provider_retention");
        return !archived && keep?.endDate && Date.parse(keep.endDate) > ctx.now();
      })
      .map((u) => u.id);
    return {
      batch_id: g.batch.id,
      currency: g.batch.currency,
      resources,
      events,
      at_risk_unit_ids: at_risk,
      // Sources that could not be read: their events are missing, not absent.
      unavailable: g.unavailable,
      generated_at: new Date(ctx.now()).toISOString(),
    };
  });

  // One row per batch (or per clip with ?level=clip) for an operations grid and charts.
  endpoint(app, ctx, "GET", "/v1/operations/dashboard", ["operator"], ["operator", "integration"], async (a, _b, _p, _k, req) => {
    const q = z.object({ level: z.enum(["batch", "clip"]).default("batch"), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
    const batches = (await ctx.db.list<Json>(a.tenant, "batch", undefined, 500)).slice(-q.limit).reverse();
    const rows: Json[] = [];
    for (const b of batches) {
      const g = await gather(a.tenant, String(b.id));
      const units = (b.units as { id: string; price_minor: number }[]) ?? [];
      const capture = g.ops.find((o) => o.kind === "CAPTURE" && o.state === "CONFIRMED");
      const refunded = g.ops.filter((o) => o.kind === "REFUND" && o.state === "CONFIRMED").reduce((s, o) => s + Number(o.amount_minor), 0);
      const openDisputes = g.disputes.filter((d) => d.status !== "RESOLVED");
      if (q.level === "clip") {
        units.forEach((u, i) => {
          const art = g.artifacts.find((x) => x.unit_id === u.id);
          const att = g.attempts.find((x) => x.unit_id === u.id);
          const probe = g.playback.find((x) => x.unit_id === u.id);
          rows.push({
            batch_id: b.id,
            batch_title: b.title ?? null,
            clip: i + 1,
            unit_id: u.id,
            currency: b.currency,
            price_minor: u.price_minor,
            provider_source: att?.source ?? null,
            task_state: att?.state ?? "NOT_REGISTERED",
            archived: art?.state === "STORED",
            delivered: art?.published === true,
            recovered: g.recoveries.some((r) => r.unit_id === u.id),
            external_playback: probe?.outcome ?? null,
          });
        });
        continue;
      }
      const delivered = g.artifacts.filter((x) => x.published === true).length;
      const moneyKnown = !g.unavailable.includes("operations") && !g.unavailable.includes("authorization");
      const mediaKnown = !g.unavailable.includes("artifacts") && !g.unavailable.includes("attempts");
      rows.push({
        unavailable: g.unavailable,
        batch_id: b.id,
        title: b.title ?? null,
        created_at: b.created_at,
        state: b.state,
        currency: b.currency,
        clips: units.length,
        archived: mediaKnown ? g.artifacts.filter((x) => x.state === "STORED").length : null,
        delivered: mediaKnown ? delivered : null,
        archived_not_delivered: mediaKnown ? g.artifacts.filter((x) => x.state === "STORED" && x.published !== true).length : null,
        recovered: g.recoveries.length,
        // No successful provider output and nothing archived: failed tasks count here too.
        never_rendered: mediaKnown
          ? units.filter(
              (u) =>
                !g.attempts.some((x) => x.unit_id === u.id && x.state === "SUCCEEDED") &&
                !g.artifacts.some((x) => x.unit_id === u.id),
            ).length
          : null,
        no_provider_task: mediaKnown ? units.filter((u) => !g.attempts.some((x) => x.unit_id === u.id)).length : null,
        authorized_minor: moneyKnown ? (g.auth?.state === "AUTHORIZED" ? Number(b.ceiling_minor) : 0) : null,
        charged_minor: moneyKnown ? (capture ? Number(capture.amount_minor) : 0) : null,
        not_taken_minor: moneyKnown && (capture || g.ops.some((o) => o.kind === "VOID" && o.state === "CONFIRMED")) ? Number(b.ceiling_minor) - (capture ? Number(capture.amount_minor) : 0) : null,
        refunded_minor: moneyKnown ? refunded : null,
        open_disputes: openDisputes.length,
        next_dispute_deadline: openDisputes.map((d) => d.seller_response_due_date).filter(Boolean).sort()[0] ?? null,
        playback_played: g.playback.filter((x) => x.outcome === "PLAYED").length,
        playback_probed: g.playback.length,
      });
    }
    return {
      level: q.level,
      rows,
      note: "Money is in minor units of each row's currency; never add rows of different currencies. A null value with a name in `unavailable` means that source could not be read, not zero.",
      generated_at: new Date(ctx.now()).toISOString(),
    };
  });
}
