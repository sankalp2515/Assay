import type { Context } from "./context.js";
import { LocalStore } from "../adapters/storage.js";
import { uuid, now, type Json, type Operation } from "../domain/contracts.js";
export async function maintain(ctx: Context, tenant: string) {
  if (ctx.name === "commerce") {
    const expired = await ctx.db.tx(
      tenant,
      async (q) =>
        (
          await q.query<{ body: Json }>(
            "SELECT body FROM entities WHERE kind='support_case' AND body->>'state'<>'EXPIRED' AND (body->>'retention_until')::timestamptz<=now() LIMIT 100",
          )
        ).rows,
    );
    for (const { body: c } of expired)
      await ctx.db.mutate(
        tenant,
        "support_case",
        String(c.id),
        async (old) => ({
          ...old,
          state: "EXPIRED",
          message: "Removed under the batch retention policy",
          resolution: null,
          expired_at: now(),
        }),
      );
  }
  if (ctx.name === "payments") {
    const operations = await ctx.db.tx(tenant, async (q) =>
      (
        await q.query<{ body: Operation }>(
          "SELECT body FROM entities WHERE tenant_id=$1 AND kind='operation' AND body->>'state' IN ('PENDING','UNKNOWN','DISPATCHING') ORDER BY updated_at LIMIT 100",
          [tenant],
        )
      ).rows.map((r) => r.body),
    );
    for (const op of operations.filter((o) =>
      ["PENDING", "UNKNOWN", "DISPATCHING"].includes(o.state),
    )) {
      await ctx.db.mutate<Operation>(
        tenant,
        "operation",
        op.id,
        async (current, q) => {
          if (!["PENDING", "UNKNOWN", "DISPATCHING"].includes(current.state))
            return current;
          if (
            current.last_reconcile_at &&
            ctx.now() - Date.parse(String(current.last_reconcile_at)) < 30_000
          )
            return current;
          await ctx.db.enqueue(
            q,
            tenant,
            "payments",
            "/internal/operations/" + op.id + "/reconcile",
            {},
          );
          return { ...current, last_reconcile_at: now() };
        },
      );
    }
  }
  const expiring =
    ctx.name === "delivery"
      ? await ctx.db.tx(tenant, async (q) =>
          (
            await q.query<{ body: Json }>(
              "SELECT body FROM entities WHERE tenant_id=$1 AND kind='artifact' AND body->>'state'<>'EXPIRED' AND (body->>'retention_until')::timestamptz<=now() ORDER BY updated_at LIMIT 100",
              [tenant],
            )
          ).rows.map((r) => r.body),
        )
      : [];
  if (ctx.name === "delivery")
    for (const artifact of expiring) {
      if (
        artifact.state === "EXPIRED" ||
        Date.parse(String(artifact.retention_until)) > ctx.now()
      )
        continue;
      const key = uuid.parse(artifact.id);
      await (ctx.store ?? new LocalStore(ctx.artifactDir)).remove(key);
      await ctx.db.mutate(tenant, "artifact", key, async (old) => ({
        ...old,
        state: "EXPIRED",
        published: false,
        expired_at: now(),
      }));
    }
  const running =
    ctx.name === "investigation"
      ? await ctx.db.tx(tenant, async (q) =>
          (
            await q.query<{ body: Json }>(
              "SELECT body FROM entities WHERE tenant_id=$1 AND kind='assessment' AND body->>'state'='RUNNING' ORDER BY updated_at LIMIT 100",
              [tenant],
            )
          ).rows.map((r) => r.body),
        )
      : [];
  if (ctx.name === "investigation")
    for (const run of running) {
      if (
        run.state === "RUNNING" &&
        ctx.now() - Date.parse(String(run.started_at)) > 360_000
      )
        await ctx.db.mutate(
          tenant,
          "assessment",
          String(run.id),
          async (old) => ({
            ...old,
            state: "WAITING_FOR_AI",
            error_code: "interrupted_investigation",
          }),
        );
    }
}
