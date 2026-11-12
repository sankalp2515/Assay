import type { Context } from "./context.js";
import { now, type Json } from "../domain/contracts.js";

// Which tenants a service's background worker serves. Runtime queries never bypass
// row-level security, so a worker cannot discover tenants by scanning tables. Tenants come
// from TENANT_IDS (provisioned) plus a directory kept in the platform tenant's own scope,
// written when Commerce signs a new merchant up.
export const PLATFORM_TENANT = "00000000-0000-4000-a000-000000000000";
const DIRECTORY = "tenant_directory";
let cache: { at: number; tenants: string[] } | undefined;
const MAX_WORKER_TENANTS = 5000;

// expiresAt: hosted demo workspaces stop being served after a day.
export async function registerTenant(ctx: Context, tenant: string, expiresAt?: string) {
  await ctx.db.tx(PLATFORM_TENANT, (q) =>
    ctx.db.put(q, PLATFORM_TENANT, DIRECTORY, tenant, {
      id: tenant,
      registered_at: now(),
      ...(expiresAt ? { expires_at: expiresAt } : {}),
    }),
  );
  cache = undefined;
}

// Workers keep serving a demo workspace for a grace period after its interactive access
// ends (TENANT_WORKER_GRACE_HOURS, default a week, the clip retention), so reconciliation,
// outbox delivery and retention cleanup still finish. Expiry is filtered in SQL and the
// newest workspaces come first, so a long tail of old demo workspaces can never push new
// ones out of the worker's list.
export async function knownTenants(ctx: Context, env = process.env) {
  if (cache && Date.now() - cache.at < 30_000) return cache.tenants;
  const provisioned = (env.TENANT_IDS ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const graceHours = Math.max(0, Number(env.TENANT_WORKER_GRACE_HOURS ?? 168) || 0);
  const listed = await ctx.db.tx(PLATFORM_TENANT, async (q) => {
    const r = await q.query<{ id: string }>(
      `SELECT body->>'id' AS id FROM entities
        WHERE tenant_id=$1 AND kind=$2
          AND (body->>'expires_at' IS NULL
               OR (body->>'expires_at')::timestamptz > now() - make_interval(hours => $3::int))
        ORDER BY created_at DESC, id
        LIMIT $4`,
      [PLATFORM_TENANT, DIRECTORY, Math.round(graceHours), MAX_WORKER_TENANTS],
    );
    return r.rows.map((row) => String(row.id));
  });
  const tenants = [...new Set([...provisioned, ...listed])];
  cache = { at: Date.now(), tenants };
  return tenants;
}

export function resetTenantCache() {
  cache = undefined;
}
