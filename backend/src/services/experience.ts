import type { FastifyInstance } from "fastify";
import type { Context } from "../core/context.js";
import { endpoint } from "../core/http.js";
import { requireThat } from "../core/errors.js";
import {
  id,
  now,
  uuid,
  stableId,
  type Batch,
  type Json,
  type Permit,
} from "../domain/contracts.js";
import {
  STATEMENT_TYP,
  statementKeys,
  verifyStatement,
} from "../domain/statement.js";
import {
  interpretationSchema,
  resolveClaims,
  type ClipView,
} from "../domain/claims.js";
import { z } from "zod";
import { services } from "../domain/contracts.js";

export function experienceRoutes(app: FastifyInstance, ctx: Context) {
  const owned = async (
    a: { tenant: string; role: string; subject: string },
    key: string,
  ) => {
    const b = await ctx.db.get<Batch>(a.tenant, "batch", uuid.parse(key));
    requireThat(
      b && (a.role === "operator" || b.buyer_id === a.subject),
      "not_found",
      "Batch not found",
      404,
    );
    return b;
  };
  // AI reads the buyer's words into clip claims; rules below decide every outcome.
  // A buyer must not be able to drain the merchant's shared daily AI budget, which
  // investigations also need. Past the per-order cap, messages go straight to the merchant.
  const readingsPerOrder = () =>
    Math.min(
      20,
      Math.max(1, Number(process.env.MAX_BUYER_READINGS_PER_BATCH ?? 5) || 5),
    );
  const readMessage = async (tenant: string, b: Batch, message: string) => {
    const earlier = await ctx.db.list<Json>(tenant, "support_case", b.id);
    if (
      earlier.filter((c) => (c.reading as Json | undefined)?.state === "READ")
        .length >= readingsPerOrder()
    )
      return {
        state: "MERCHANT_QUEUE",
        reply:
          "We saved your message for the merchant. Your delivered clips stay available and nothing is charged for clips you didn't get.",
      };
    let read: Json;
    try {
      read = await ctx.call(
        "investigation",
        "/internal/claims/interpret",
        tenant,
        { message, clip_count: b.units.length },
        "claim-" + stableId({ batch: b.id, message }),
      );
    } catch {
      return {
        state: "WAITING_FOR_AI",
        reply:
          "We saved your message. Your delivered clips stay available and nothing is charged for clips you didn't get.",
      };
    }
    const interpretation = interpretationSchema.parse(read.interpretation);
    const artifacts = (
      await ctx.call(
        "delivery",
        "/internal/batches/" + b.id + "/artifacts",
        tenant,
      )
    ).artifacts as Json[];
    const permit = b.proposal_id
      ? await ctx.db.get<Permit>(tenant, "permit", b.proposal_id)
      : undefined;
    const settled =
      b.state === "CLOSED" && permit?.state === "CLAIMED" ? permit : undefined;
    const clips: ClipView[] = b.units.map((u, i) => {
      const mine = artifacts.filter(
        (x) =>
          x.unit_id === u.id &&
          x.buyer_id === b.buyer_id &&
          x.contract_hash === b.contract_hash &&
          x.state === "STORED",
      );
      return {
        clip: i + 1,
        unit_id: u.id,
        price_minor: u.price_minor,
        delivered: mine.some((x) => x.published === true),
        recoverable:
          !mine.some((x) => x.published === true) && mine.length > 0,
        billed:
          !!settled &&
          settled.action === "CAPTURE" &&
          settled.unit_ids.includes(u.id),
      };
    });
    const decided = resolveClaims(interpretation, clips, !!settled);
    return {
      state: "READ",
      interpretation,
      model: read.model,
      provenance: read.provenance,
      message_hash: read.message_hash,
      ...decided,
      decided_by: "deterministic rules over delivery and payment records",
    };
  };
  endpoint(
    app,
    ctx,
    "GET",
    "/v1/readiness",
    ["operator"],
    ["operator"],
    async (a) => {
      const results = await Promise.all(
        ["payments", "provider", "delivery", "investigation"].map(
          async (name) => {
            try {
              return await ctx.call(
                name as "payments",
                "/internal/readiness",
                a.tenant,
              );
            } catch {
              return { service: name, reachable: false, available: false };
            }
          },
        ),
      );
      return {
        environment: ctx.fixture ? "fixture" : "sandbox",
        currency: "USD",
        merchant_scope: "single merchant",
        services: results,
        observed_at: now(),
      };
    },
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/v1/operations/overview",
    ["operator"],
    ["operator"],
    async (a) => {
      const results = await Promise.all(
        services.map(async (service) => {
          try {
            return await ctx.call(service, "/internal/readiness", a.tenant);
          } catch {
            return { service, reachable: false, available: false };
          }
        }),
      );
      return { services: results, observed_at: now() };
    },
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/v1/batches/:batch/attempts/:attempt/lookup",
    ["operator"],
    ["operator"],
    async (a, _b, p) => {
      const b = await owned(a, p.batch!);
      const attempts = (
        await ctx.call(
          "provider",
          "/internal/batches/" + b.id + "/attempts",
          a.tenant,
        )
      ).attempts as Json[];
      requireThat(
        attempts.some((t) => t.id === p.attempt),
        "not_found",
        "Attempt not found",
        404,
      );
      const result = await ctx.call(
        "provider",
        "/internal/attempts/" + uuid.parse(p.attempt),
        a.tenant,
      );
      return {
        id: result.id,
        unit_id: result.unit_id,
        state: result.state,
        provider_task_id: result.provider_task_id,
      };
    },
    z.strictObject({}),
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/v1/batches/:batch/financials",
    ["operator"],
    ["buyer", "operator"],
    async (a, _b, p) => {
      await owned(a, p.batch!);
      return ctx.call(
        "payments",
        "/internal/batches/" + p.batch + "/financials",
        a.tenant,
      );
    },
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/v1/batches/:batch/settlement-status",
    ["operator"],
    ["buyer", "operator"],
    async (a, _b, p) => {
      const b = await owned(a, p.batch!);
      const permit = b.proposal_id
        ? await ctx.db.get(a.tenant, "permit", b.proposal_id)
        : undefined;
      return {
        batch_id: b.id,
        batch_state: b.state,
        proposal: permit
          ? {
              id: permit.id,
              state: permit.state,
              amount_minor: permit.amount_minor,
              currency: permit.currency,
              action: permit.action,
              expires_at: permit.expires_at,
            }
          : null,
      };
    },
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/v1/batches/:batch/activity",
    ["operator"],
    ["buyer", "operator"],
    async (a, _b, p) => {
      const b = await owned(a, p.batch!);
      // A scoped operational journal, without prompts, provider URLs or secret payloads.
      const rows = await ctx.db.tx(a.tenant, (q) =>
        q.query<{ body: Json }>(
          "SELECT body FROM entities WHERE kind='batch_event' AND body->>'batch_id'=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
          [b.id],
        ),
      );
      return {
        batch_id: b.id,
        events: rows.rows.map(({ body: e }) => ({
          sequence: e.id,
          action: e.state,
          recorded_at: e.recorded_at,
        })),
        observed_at: now(),
      };
    },
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/v1/batches/:batch/statement",
    ["operator"],
    ["buyer", "operator"],
    async (a, _b, p) => {
      const b = await owned(a, p.batch!);
      return ctx.call("payments", "/internal/batches/" + b.id + "/statement", a.tenant);
    },
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/v1/statements/verify",
    ["operator"],
    ["buyer", "operator"],
    async (_a, raw) => verifyStatement(ctx.identity, (raw as { jws: string }).jws),
    z.strictObject({ jws: z.string().min(20).max(20000) }),
  );
  // Public keys only: anyone holding a statement can verify it without an account.
  app.get(
    "/v1/statements/keys",
    {
      schema: {
        tags: ["commerce"],
        security: [],
        summary: "Public Ed25519 keys that sign delivery statements",
      },
    },
    async () => ({ typ: STATEMENT_TYP, alg: "EdDSA", keys: statementKeys(ctx.identity) }),
  );
  // Outcomes the merchant can see from its own records. Cost avoided uses the
  // merchant-configured re-render cost, so it is an estimate, not a measured saving.
  endpoint(
    app,
    ctx,
    "GET",
    "/v1/operations/impact",
    ["operator"],
    ["operator"],
    async (a) => {
      const rows = await ctx.db.tx(a.tenant, (q) =>
        q.query<{ kind: string; body: Json }>(
          "SELECT kind, body FROM entities WHERE kind IN ('recovery','permit','batch','support_case') ORDER BY created_at,id LIMIT 5000",
        ),
      );
      const of = (k: string) => rows.rows.filter((r) => r.kind === k).map((r) => r.body);
      const recoveries = of("recovery");
      const batches = new Map(of("batch").map((b) => [String(b.id), b as Batch]));
      const settled = of("permit").filter((p) => {
        const b = batches.get(String(p.batch_id));
        return p.state === "CLAIMED" && b?.state === "CLOSED" && b.proposal_id === p.id;
      }) as Permit[];
      // Money is never summed across currencies. Top-level totals are USD; every
      // currency (USD included) also appears under by_currency.
      const cur = (batchId: unknown) => String(batches.get(String(batchId))?.currency ?? "USD");
      const by_currency: Record<string, { settled_batches: number; authorized_minor: number; charged_minor: number; never_taken_minor: number; recovered_clip_list_value_minor: number }> = {};
      const bucket = (c: string) =>
        (by_currency[c] ??= { settled_batches: 0, authorized_minor: 0, charged_minor: 0, never_taken_minor: 0, recovered_clip_list_value_minor: 0 });
      for (const p of settled) {
        const b = bucket(cur(p.batch_id));
        const ceiling = Number(batches.get(p.batch_id)?.ceiling_minor ?? 0);
        const take = p.action === "CAPTURE" ? p.amount_minor : 0;
        b.settled_batches++;
        b.authorized_minor += ceiling;
        b.charged_minor += take;
        b.never_taken_minor += ceiling - take;
      }
      for (const r of recoveries) bucket(cur(r.batch_id)).recovered_clip_list_value_minor += Number(r.unit_price_minor ?? 0);
      const usd = by_currency.USD ?? { settled_batches: 0, authorized_minor: 0, charged_minor: 0, never_taken_minor: 0, recovered_clip_list_value_minor: 0 };
      const charged = usd.charged_minor;
      const authorized = usd.authorized_minor;
      const cases = of("support_case");
      const read = cases.filter((c) => (c.reading as Json | undefined)?.state === "READ");
      const outcomes: Record<string, number> = {};
      for (const c of read)
        for (const r of ((c.reading as Json).resolutions as Json[]) ?? [])
          outcomes[String(r.outcome)] = (outcomes[String(r.outcome)] ?? 0) + 1;
      return {
        clips_recovered_without_rerender: recoveries.length,
        recovered_clip_list_value_minor: usd.recovered_clip_list_value_minor,
        estimated_rerender_cost_avoided_minor: recoveries.reduce(
          (s, r) => s + Number(r.rerender_cost_minor ?? 0),
          0,
        ),
        rerender_cost_basis: "merchant-configured PROVIDER_RERENDER_COST_MINOR per clip; estimate",
        settled_batches: usd.settled_batches,
        authorized_minor: authorized,
        charged_minor: charged,
        never_taken_minor: authorized - charged,
        buyer_messages: cases.length,
        buyer_messages_read_by_ai: read.length,
        buyer_message_outcomes: outcomes,
        currency: "USD",
        by_currency,
        limit: 5000,
      };
    },
  );
  const caseInput = z.strictObject({
    category: z.enum(["access", "payment", "creative", "other"]),
    message: z.string().min(10).max(2000),
    unit_id: uuid.optional(),
  });
  endpoint(
    app,
    ctx,
    "GET",
    "/v1/support",
    ["operator"],
    ["operator"],
    async (a) => {
      const rows = await ctx.db.tx(a.tenant, (q) =>
        q.query<{ body: Json }>(
          "SELECT body FROM entities WHERE kind='support_case' AND body->>'state'='OPEN' ORDER BY created_at,id LIMIT 100",
        ),
      );
      return { items: rows.rows.map((r) => r.body), limit: 100 };
    },
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/v1/batches/:batch/support",
    ["operator"],
    ["buyer", "operator"],
    async (a, raw, p, key) => {
      const b = await owned(a, p.batch!);
      const input = caseInput.parse(raw);

      requireThat(
        !input.unit_id || b.units.some((u) => u.id === input.unit_id),
        "invalid_unit",
        "Choose a unit in this batch",
        400,
      );
      requireThat(
        !/https?:\/\/|bearer\s|api[_-]?key/i.test(input.message),
        "private_data",
        "Describe the issue without links, tokens or API keys",
        400,
      );
      const created = await ctx.db.create<Json>(
        a.tenant,
        "support_case",
        key,
        { ...input, batch_id: b.id, actor: a.subject },
        {
          id: id(),
          batch_id: b.id,
          ...input,
          submitted_by: a.subject,
          state: "OPEN",
          created_at: now(),
          retention_until: b.retention_until,
        },
        undefined,
        // Runs only for a new message, so an idempotent replay is never rejected.
        async (q) => {
          const count = await q.query<{ n: string }>(
            "SELECT count(*) AS n FROM entities WHERE kind='support_case' AND body->>'batch_id'=$1",
            [b.id],
          );
          requireThat(
            Number(count.rows[0]?.n ?? 0) < 50,
            "too_many_messages",
            "This order already has the maximum number of messages; the merchant will reply",
            429,
          );
        },
      );
      if (
        created.reading &&
        (created.reading as Json).state !== "WAITING_FOR_AI"
      )
        return created;
      // The model call happens outside the row transaction; only the result is stored.
      const reading = await readMessage(a.tenant, b, input.message);
      return ctx.db.mutate<Json>(
        a.tenant,
        "support_case",
        String(created.id),
        async (c) => ({ ...c, reading }),
      );
    },
    caseInput,
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/v1/batches/:batch/support",
    ["operator"],
    ["buyer", "operator"],
    async (a, _b, p) => {
      const b = await owned(a, p.batch!);
      const items = await ctx.db.list<Json>(a.tenant, "support_case", b.id);
      return {
        items: items.filter(
          (c) => a.role === "operator" || c.submitted_by === a.subject,
        ),
      };
    },
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/v1/batches/:batch/support/:case/resolve",
    ["operator"],
    ["operator"],
    async (a, raw, p) => {
      await owned(a, p.batch!);
      const input = raw as { resolution: string };
      return ctx.db.mutate<Json>(
        a.tenant,
        "support_case",
        uuid.parse(p.case),
        async (c) => {
          requireThat(
            c.batch_id === p.batch,
            "not_found",
            "Case not found",
            404,
          );
          requireThat(c.state === "OPEN","case_closed","This issue is closed or its retention period ended");
          return {
            ...c,
            state: "RESOLVED",
            resolution: input.resolution,
            resolved_at: now(),
          };
        },
      );
    },
    z.strictObject({ resolution: z.string().min(10).max(1000) }),
  );
}
