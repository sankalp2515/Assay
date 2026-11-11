import type { Context } from "./context.js";
import { now, type Json } from "../domain/contracts.js";

// Which tenants a service's background worker serves. Runtime queries never bypass
// row-level security, so a worker cannot discover tenants by scanning tables. Tenants come
// from TENANT_IDS (provisioned) plus a directory kept in the platform tenant's own scope,
// written when Commerce signs a new merchant up.
export const PLATFORM_TENANT = "00000000-0000-4000-a000-000000000000";
const DIRECTORY = "tenant_directory";
let cache: { at: number; tenants: string[] } | undefined;

export async function registerTenant(ctx: Context, tenant: string) {
  await ctx.db.tx(PLATFORM_TENANT, (q) =>
    ctx.db.put(q, PLATFORM_TENANT, DIRECTORY, tenant, { id: tenant, registered_at: now() }),
  );
  cache = undefined;
}

export async function knownTenants(ctx: Context, env = process.env) {
  if (cache && Date.now() - cache.at < 30_000) return cache.tenants;
  const provisioned = (env.TENANT_IDS ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const listed = (await ctx.db.list<Json>(PLATFORM_TENANT, DIRECTORY, undefined, 1000)).map((r) => String(r.id));
  const tenants = [...new Set([...provisioned, ...listed])];
  cache = { at: Date.now(), tenants };
  return tenants;
}
