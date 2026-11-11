import { token } from "./auth.js";
import type { Identity } from "./auth.js";
import { Problem } from "./errors.js";
import type { Call, Context } from "./context.js";
import type { Json, Service } from "../domain/contracts.js";
import { WEBHOOK_TARGET, deliverWebhook } from "./webhooks.js";
export function httpTransport(
  identity: Identity,
  urls: Record<Service, string>,
): Call {
  return async (target, path, tenant, body, key) => {
    if (!path.startsWith("/internal/"))
      throw new Error("Internal transport path required");
    const response = await fetch(new URL(path, urls[target]), {
      method: body ? "POST" : "GET",
      headers: {
        authorization: "Bearer " + (await token(identity, target, tenant)),
        "content-type": "application/json",
        ...(key ? { "idempotency-key": key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(
        target === "investigation" && path.endsWith("/run") ? 270000 : 15000,
      ),
      redirect: "error",
    });
    const payload = (await response.json()) as Json;
    if (!response.ok)
      throw new Problem(
        response.status,
        String(payload.code ?? "remote_failure"),
        "Remote service rejected the operation",
      );
    return payload;
  };
}
export async function dispatchOutbox(ctx: Context, tenant: string) {
  // Per-tenant polling preserves RLS. Operator tenant IDs are provisioned, never discovered using a bypass role.
  const job = await ctx.db.tx(tenant, async (q) => {
    const r = await q.query(
      "SELECT * FROM outbox WHERE tenant_id=$1 AND ((state='READY' AND next_at<=now()) OR (state='SENDING' AND lease_until<now())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
      [tenant],
    );
    const row = r.rows[0];
    if (!row) return;
    await q.query(
      "UPDATE outbox SET state='SENDING',attempts=attempts+1,lease_until=now()+($2::text||' seconds')::interval WHERE id=$1",
      [
        row.id,
        row.target === "investigation" && String(row.path).endsWith("/run")
          ? 300
          : 30,
      ],
    );
    return row;
  });
  if (!job) return false;
  try {
    if (job.target === WEBHOOK_TARGET) await deliverWebhook(job.body as Json);
    else
      await ctx.call(
        job.target as Service,
        job.path as string,
        tenant,
        job.body as Json,
        job.id as string,
      );
    await ctx.db.tx(tenant, (q) =>
      q.query(
        "UPDATE outbox SET state='DONE',lease_until=NULL WHERE id=$1 AND state='SENDING' AND attempts=$2",
        [job.id, Number(job.attempts) + 1],
      ),
    );
  } catch (e) {
    const count = Number(job.attempts) + 1;
    const transient =
      !(e instanceof Problem) || e.status >= 500 || e.status === 429;
    await ctx.db.tx(tenant, (q) =>
      q.query(
        "UPDATE outbox SET state=$2,lease_until=NULL,next_at=now()+($3::text||' milliseconds')::interval WHERE id=$1 AND state='SENDING' AND attempts=$4",
        [
          job.id,
          transient && count < 12 ? "READY" : "DEAD",
          Math.min(60000, 1000 * 2 ** Math.min(count, 6)) +
            Math.floor(Math.random() * 250),
          count,
        ],
      ),
    );
  }
  return true;
}
