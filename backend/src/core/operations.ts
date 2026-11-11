import type { FastifyInstance } from "fastify";
import type { Context } from "./context.js";
import { endpoint } from "./http.js";
/** Authenticated, tenant-scoped queue diagnostics; never emits evidence or secrets. */
export function operationsRoutes(app: FastifyInstance, ctx: Context) {
  endpoint(
    app,
    ctx,
    "GET",
    "/internal/readiness",
    ["commerce"],
    undefined,
    async (a) => {
      const key = (await import("../domain/contracts.js")).stableId({
        tenant: a.tenant,
        control: "payments",
      });
      const control =
        ctx.name === "payments"
          ? await ctx.db.get(a.tenant, "dispatch_control", key)
          : undefined;
      const diagnostics = await ctx.db.tx(a.tenant, async (q) => ({
        queues: (
          await q.query(
            "SELECT state,count(*)::int AS count,min(created_at) AS oldest_created_at FROM outbox GROUP BY state",
          )
        ).rows,
        dead_letters: (
          await q.query(
            "SELECT id,target,state,attempts,created_at FROM outbox WHERE state='DEAD' ORDER BY created_at LIMIT 50",
          )
        ).rows,
      }));
      return {
        service: ctx.name,
        reachable: true,
        available:
          ctx.name === "payments"
            ? !!ctx.paypal?.available
            : ctx.name === "provider"
              ? !!ctx.provider?.available
              : ctx.name === "investigation"
                ? !!ctx.model?.available
                : true,
        environment: ctx.fixture ? "fixture" : "sandbox",
        payments_paused: control?.paused === true,
        paid_inference_enabled: ctx.allowPaid,
        ...diagnostics,
        ...(ctx.name === "payments"
          ? { merchant: ctx.merchantId || null }
          : {}),
        observed_at: new Date(ctx.now()).toISOString(),
      };
    },
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/v1/operations/health",
    ["operator"],
    ["operator"],
    async (actor) => {
      const summary = await ctx.db.tx(actor.tenant, async (q) => {
        const queues = (
          await q.query(
            "SELECT state,count(*)::int AS count,min(created_at) AS oldest_created_at FROM outbox GROUP BY state",
          )
        ).rows;
        const unresolved =
          ctx.name === "payments"
            ? (
                await q.query(
                  "SELECT body->>'state' AS state,count(*)::int AS count FROM entities WHERE kind='operation' AND body->>'state' IN ('UNKNOWN','PENDING','DISPATCHING','NEEDS_REVIEW') GROUP BY body->>'state'",
                )
              ).rows
            : [];
        return { queues, unresolved_payments: unresolved };
      });
      return { service: ctx.name, at: new Date().toISOString(), ...summary };
    },
  );
}
