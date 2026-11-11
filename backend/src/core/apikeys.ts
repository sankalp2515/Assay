import { randomBytes, createHash } from "node:crypto";
import type { Context } from "./context.js";
import type { Actor } from "./auth.js";
import { Problem } from "./errors.js";
import { stableId, type Json } from "../domain/contracts.js";

// Merchant credentials that a merchant's own server holds.
//
//   assay_sk_<tenant>_<secret>   secret key. Scope "operator" can do everything an operator
//                                can; scope "integration" can open batches, register tasks
//                                and read, but cannot approve a settlement or a refund.
//   assay_bt_<tenant>_<secret>   buyer session for one buyer and one batch, 30 minutes.
//                                The merchant's server mints it for its own logged-in buyer.
//
// Only a SHA-256 of each credential is stored; the value is shown once. The tenant is in
// the credential so lookup stays inside that tenant's row-level security scope.
export type KeyScope = "operator" | "integration";
const PATTERN = /^assay_(sk|bt)_([0-9a-f]{32})_([A-Za-z0-9_-]{43})$/;
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const asUuid = (h: string) =>
  `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
export const credentialId = (value: string) => stableId({ credential: hash(value) });

export function newCredential(kind: "sk" | "bt", tenant: string) {
  const value = `assay_${kind}_${tenant.replace(/-/g, "")}_${randomBytes(32).toString("base64url")}`;
  return { value, id: credentialId(value), prefix: value.slice(0, 22) + "…" };
}

export function looksLikeCredential(header: string | undefined) {
  return !!header && /^Bearer assay_(sk|bt)_/.test(header);
}

// Resolves a credential to the same Actor shape that a signed operator or buyer token
// produces, so every route keeps one authorization check.
export async function resolveCredential(
  ctx: Context,
  header: string,
  path: string,
): Promise<Actor> {
  const m = PATTERN.exec(header.slice(7));
  if (!m) throw new Problem(401, "unauthorized", "Invalid or expired credential");
  const [, kind, tenantHex, ] = m;
  const tenant = asUuid(tenantHex!);
  const value = header.slice(7);
  const row = await ctx.db.get<Json>(tenant, kind === "sk" ? "api_key" : "buyer_session", credentialId(value));
  if (!row || row.revoked_at || row.hash !== hash(value))
    throw new Problem(401, "unauthorized", "Invalid or expired credential");
  if (kind === "bt") {
    if (Date.parse(String(row.expires_at)) <= ctx.now())
      throw new Problem(401, "unauthorized", "Invalid or expired credential");
    // A buyer session opens exactly one batch.
    const scoped = new RegExp("^/v1/batches/" + String(row.batch_id) + "(/|$)");
    if (!scoped.test(path)) throw new Problem(403, "forbidden", "This buyer session is for a different batch");
    return {
      tenant,
      subject: String(row.buyer_id),
      issuer: "operator",
      role: "buyer",
      environment: "sandbox",
    };
  }
  return {
    tenant,
    subject: String(row.operator_id),
    issuer: "operator",
    role: row.scope === "integration" ? "integration" : "operator",
    environment: "sandbox",
  };
}

export const storedCredential = (value: string) => ({ hash: hash(value) });
