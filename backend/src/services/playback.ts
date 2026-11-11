import type { FastifyInstance } from "fastify";
import type { Context } from "../core/context.js";
import { endpoint } from "../core/http.js";
import { token } from "../core/auth.js";
import { requireThat } from "../core/errors.js";
import { now, stableId, uuid, type Json } from "../domain/contracts.js";

// External playback probes (KERNEL). Queued after a clip is delivered or recovered; never
// on the money path. Needs PLAYBACK_PROBE_ORIGIN: the public https origin where this
// deployment serves /v1/artifacts/{id}/content (the hosted Caddy routes it to Delivery).
const origin = () => {
  const raw = process.env.PLAYBACK_PROBE_ORIGIN ?? "";
  if (!raw) return undefined;
  const u = new URL(raw);
  if (u.protocol !== "https:" || u.username || u.password || u.pathname !== "/") return undefined;
  return u.origin;
};
const dailyCap = () => Math.max(0, Math.min(500, Number(process.env.KERNEL_MAX_PROBES_PER_DAY ?? 40) || 0));

export function probesEnabled(ctx: Context) {
  return !!(ctx.prober?.available && origin());
}

export function playbackRoutes(app: FastifyInstance, ctx: Context) {
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/artifacts/:artifact/playback-probe",
    ["delivery"],
    undefined,
    async (a, _raw, p) => {
      const key = uuid.parse(p.artifact);
      const base = origin();
      if (!ctx.prober?.available || !base) return { skipped: "not_configured" };
      const artifact = await ctx.db.get<Json>(a.tenant, "artifact", key);
      requireThat(artifact, "not_found", "Artifact not found", 404);
      if (artifact.published !== true || artifact.state !== "STORED") return { skipped: "not_retrievable" };
      // A per-tenant daily budget: KERNEL browsers cost credits.
      const day = new Date(ctx.now()).toISOString().slice(0, 10);
      const allowed = await ctx.db.tx(a.tenant, async (q) => {
        await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenant + "probe-budget"]);
        const counterId = stableId({ probe_budget: day });
        const c = await ctx.db.getIn<Json>(q, a.tenant, "probe_budget", counterId, true);
        const used = Number(c?.used ?? 0);
        if (used >= dailyCap()) return false;
        await ctx.db.put(q, a.tenant, "probe_budget", counterId, { id: counterId, day, used: used + 1 });
        return true;
      });
      const recordId = stableId({ playback_probe: key });
      const base_record = {
        id: recordId,
        batch_id: artifact.batch_id,
        unit_id: artifact.unit_id,
        artifact_id: key,
        expected_sha256: artifact.sha256,
        probed_at: now(),
      };
      if (!allowed) {
        await ctx.db.tx(a.tenant, (q) =>
          ctx.db.put(q, a.tenant, "playback_probe", recordId, { ...base_record, outcome: "SKIPPED_BUDGET" }),
        );
        return { skipped: "daily_budget" };
      }
      // Two-minute verifier token for this buyer's route; it is sent only inside the
      // probe script to the KERNEL browser and expires before anyone could reuse it.
      const bearer = await token(ctx.identity, "delivery", a.tenant, "verifier", String(artifact.buyer_id));
      let record: Json;
      try {
        const r = await ctx.prober.probe({
          pageUrl: base + "/",
          contentUrl: base + "/v1/artifacts/" + key + "/content",
          bearer,
          expectedSha256: String(artifact.sha256),
        });
        record = { ...base_record, ...r };
      } catch (e) {
        record = {
          ...base_record,
          outcome: "PROBE_ERROR",
          browser: "kernel-chromium",
          error: String((e as Error).message ?? "probe failed").slice(0, 200),
        };
      }
      await ctx.db.tx(a.tenant, (q) => ctx.db.put(q, a.tenant, "playback_probe", recordId, record));
      return record;
    },
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/internal/batches/:batch/playback",
    ["commerce"],
    undefined,
    async (a, _b, p) => ({
      enabled: probesEnabled(ctx),
      probes: await ctx.db.list(a.tenant, "playback_probe", uuid.parse(p.batch)),
    }),
  );
}

// Called after a successful publish. Outbox, so a KERNEL outage never blocks delivery.
export async function queueProbe(ctx: Context, tenant: string, artifactId: string) {
  if (!probesEnabled(ctx)) return;
  await ctx.db.tx(tenant, (q) =>
    ctx.db.enqueue(q, tenant, "delivery", "/internal/artifacts/" + artifactId + "/playback-probe", {}),
  );
}

// What a buyer or dispute reviewer may see: no replay link, no error internals.
export function publicProbe(p: Json) {
  return {
    unit_id: p.unit_id,
    artifact_id: p.artifact_id,
    outcome: p.outcome,
    digest_matches: !!p.sha256 && p.sha256 === p.expected_sha256,
    played_to_seconds: p.current_time ?? null,
    resolution: p.width && p.height ? `${p.width}x${p.height}` : null,
    browser: p.browser ?? null,
    probed_at: p.probed_at,
    replay_recorded: !!p.replay_id,
  };
}
