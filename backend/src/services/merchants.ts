import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Context } from "../core/context.js";
import { endpoint } from "../core/http.js";
import { requireThat } from "../core/errors.js";
import { now, stableId, type Json } from "../domain/contracts.js";
import { PLATFORM_TENANT } from "../core/tenants.js";
// Singleton rows per tenant use a fixed, valid entity id.
const CURRENT = stableId("singleton");

// Each merchant connects their own PayPal business account, so their buyers pay them
// directly. Assay acts for the merchant through PayPal partner onboarding (third-party
// permissions) and never holds the merchant's PayPal credentials.
//
// Off unless PAYPAL_PARTNER_MODE=true: the platform's PayPal app must be approved as a
// partner first. Without it, every tenant uses the platform's own account (the
// single-merchant deployment used for the hackathon receipts).
export { PLATFORM_TENANT };
const partnerMode = () => process.env.PAYPAL_PARTNER_MODE === "true";
const merchantIdSchema = z.string().regex(/^[A-Z0-9]{8,20}$/);

export async function merchantFor(ctx: Context, tenant: string) {
  if (!partnerMode()) return ctx.merchantId;
  const link = await ctx.db.get<Json>(tenant, "paypal_merchant", CURRENT);
  return link?.state === "ACTIVE" && typeof link.merchant_id === "string"
    ? link.merchant_id
    : ctx.merchantId;
}

export async function tenantForMerchant(ctx: Context, merchantId: string) {
  if (!partnerMode() || !merchantIdSchema.safeParse(merchantId).success) return undefined;
  const row = await ctx.db.get<Json>(PLATFORM_TENANT, "merchant_tenant", stableId(merchantId));
  return typeof row?.tenant_id === "string" ? row.tenant_id : undefined;
}

const actionUrl = (resource: Json) =>
  (resource.links as Json[] | undefined)?.find((l) => l.rel === "action_url")?.href;

export function merchantRoutes(app: FastifyInstance, ctx: Context) {
  endpoint(
    app,
    ctx,
    "GET",
    "/internal/merchant/paypal",
    ["commerce"],
    undefined,
    async (a) => {
      const link = await ctx.db.get<Json>(a.tenant, "paypal_merchant", CURRENT);
      return {
        partner_mode: partnerMode(),
        state: partnerMode() ? (link?.state ?? "NOT_CONNECTED") : "PLATFORM_ACCOUNT",
        merchant_id: partnerMode() ? (link?.state === "ACTIVE" ? link.merchant_id : null) : null,
        uses_platform_account: (await merchantFor(ctx, a.tenant)) === ctx.merchantId,
        action_url: link?.state === "PENDING" ? link.action_url : null,
        updated_at: link?.updated_at ?? null,
      };
    },
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/merchant/paypal/onboarding",
    ["commerce"],
    undefined,
    async (a, raw) => {
      const b = raw as { return_url: string };
      requireThat(partnerMode(), "partner_mode_off", "PayPal partner onboarding is not enabled on this deployment");
      requireThat(
        ctx.paypal?.available && ctx.paypal.createPartnerReferral,
        "integration_unavailable",
        "PayPal is required",
        503,
      );
      const existing = await ctx.db.get<Json>(a.tenant, "paypal_merchant", CURRENT);
      requireThat(existing?.state !== "ACTIVE", "already_connected", "A PayPal account is already connected");
      // tracking_id binds the PayPal account that completes sign-up to this tenant.
      const resource = await ctx.paypal.createPartnerReferral(a.tenant, b.return_url);
      const url = actionUrl(resource);
      requireThat(
        typeof url === "string" && /^https:\/\/www\.sandbox\.paypal\.com\//.test(url),
        "paypal_rejected",
        "PayPal did not return a sign-up link",
        502,
      );
      return ctx.db.tx(a.tenant, async (q) => {
        const record = {
          id: CURRENT,
          state: "PENDING",
          tracking_id: a.tenant,
          action_url: url,
          updated_at: now(),
        };
        await ctx.db.put(q, a.tenant, "paypal_merchant", CURRENT, record);
        return { state: "PENDING", action_url: url };
      });
    },
    z.strictObject({ return_url: z.string().regex(/^https?:\/\/\S+$/).max(500) }),
  );
  // Called after PayPal sends the merchant back. The redirect's query is only a hint:
  // the merchant id must read back from PayPal with this tenant's tracking id, payments
  // receivable, a confirmed email and third-party permissions granted to this app.
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/merchant/paypal/complete",
    ["commerce"],
    undefined,
    async (a, raw) => {
      const b = raw as { merchant_id: string };
      requireThat(partnerMode(), "partner_mode_off", "PayPal partner onboarding is not enabled on this deployment");
      requireThat(
        ctx.paypal?.available && ctx.paypal.getMerchantIntegration,
        "integration_unavailable",
        "PayPal is required",
        503,
      );
      const m = await ctx.paypal.getMerchantIntegration(b.merchant_id);
      const grants = ((m.oauth_integrations as Json[] | undefined) ?? []).flatMap(
        (i) => (i.oauth_third_party as Json[] | undefined) ?? [],
      );
      requireThat(
        m.merchant_id === b.merchant_id &&
          m.tracking_id === a.tenant &&
          m.payments_receivable === true &&
          m.primary_email_confirmed === true &&
          grants.some((g) => g.partner_client_id === ctx.paypal?.clientId),
        "merchant_not_ready",
        "PayPal has not confirmed this account for this merchant yet. Finish sign-up in PayPal, confirm the email address, then try again.",
      );
      const registry = stableId(b.merchant_id);
      await ctx.db.tx(PLATFORM_TENANT, async (q) => {
        await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["merchant-link" + registry]);
        const owner = await ctx.db.getIn<Json>(q, PLATFORM_TENANT, "merchant_tenant", registry, true);
        requireThat(
          !owner || owner.tenant_id === a.tenant,
          "merchant_taken",
          "This PayPal account is connected to another merchant",
        );
        await ctx.db.put(q, PLATFORM_TENANT, "merchant_tenant", registry, {
          id: registry,
          tenant_id: a.tenant,
          linked_at: now(),
        });
      });
      return ctx.db.tx(a.tenant, async (q) => {
        const record = {
          id: CURRENT,
          state: "ACTIVE",
          merchant_id: b.merchant_id,
          tracking_id: a.tenant,
          updated_at: now(),
        };
        await ctx.db.put(q, a.tenant, "paypal_merchant", CURRENT, record);
        return { state: "ACTIVE", merchant_id: b.merchant_id };
      });
    },
    z.strictObject({ merchant_id: merchantIdSchema }),
  );
}
