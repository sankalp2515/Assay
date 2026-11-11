import type { PayPal, PayOptions } from "../core/context.js";
import { Problem, unavailable } from "../core/errors.js";
import { withBatch } from "../core/buyer-return.js";
import type { Json } from "../domain/contracts.js";
import { paypalValue, sameMoney, type Currency } from "../domain/money.js";
const base = "https://api-m.sandbox.paypal.com";
export const usd = (minor: number) => paypalValue(minor, "USD");
export function refundReferencesCapture(resource: Json, captureId: string) {
  const links = resource.links;
  if (!Array.isArray(links)) return false;
  return links.some((link) => {
    if (
      !link ||
      typeof link !== "object" ||
      link.rel !== "up" ||
      link.method !== "GET" ||
      typeof link.href !== "string"
    )
      return false;
    try {
      const url = new URL(link.href);
      return (
        url.protocol === "https:" &&
        ["api-m.sandbox.paypal.com", "api.sandbox.paypal.com"].includes(
          url.hostname,
        ) &&
        !url.username &&
        !url.password &&
        !url.port &&
        !url.search &&
        !url.hash &&
        url.pathname ===
          "/v2/payments/captures/" + encodeURIComponent(captureId)
      );
    } catch {
      return false;
    }
  });
}
export class PayPalSandbox implements PayPal {
  available: boolean;
  private access?: { token: string; until: number };
  constructor(
    private config: {
      clientId: string;
      secret: string;
      merchantId: string;
      webhookId: string;
      returnUrl: string;
      cancelUrl: string;
      // Partner attribution (BN code) sent on calls made for connected merchants.
      partnerAttributionId?: string;
    },
    private network: typeof fetch = fetch,
  ) {
    this.available = !!(config.clientId && config.secret && config.merchantId);
  }
  // Public by design: the PayPal JS SDK needs it in the buyer's browser.
  get clientId() {
    return this.config.clientId;
  }
  private async oauth() {
    if (!this.available) throw unavailable("PayPal Sandbox");
    if (this.access && this.access.until > Date.now()) return this.access.token;
    const r = await this.network(base + "/v1/oauth2/token", {
      method: "POST",
      headers: {
        authorization:
          "Basic " +
          Buffer.from(this.config.clientId + ":" + this.config.secret).toString(
            "base64",
          ),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!r.ok) throw unavailable("PayPal authentication");
    const d = (await r.json()) as { access_token: string; expires_in: number };
    this.access = {
      token: d.access_token,
      until: Date.now() + (d.expires_in - 60) * 1000,
    };
    return d.access_token;
  }
  async checkAuthentication() {
    await this.oauth();
    return {
      environment: "sandbox" as const,
      authenticated: true,
      token_expires_at: new Date(this.access!.until).toISOString(),
    };
  }
  // For a merchant connected through partner onboarding, the platform acts on the
  // merchant's behalf with PayPal-Auth-Assertion. The platform's own account needs none.
  private actingFor(merchantId?: string): Record<string, string> {
    if (!merchantId || merchantId === this.config.merchantId) return {};
    return {
      "PayPal-Auth-Assertion": authAssertion(this.config.clientId, merchantId),
      ...(this.config.partnerAttributionId
        ? { "PayPal-Partner-Attribution-Id": this.config.partnerAttributionId }
        : {}),
    };
  }
  private async request(
    path: string,
    method = "GET",
    body?: Json,
    key?: string,
    merchantId?: string,
  ): Promise<Json> {
    const r = await this.network(base + path, {
      method,
      headers: {
        authorization: "Bearer " + (await this.oauth()),
        "content-type": "application/json",
        ...(key ? { "PayPal-Request-Id": key } : {}),
        ...this.actingFor(merchantId),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
    if (!r.ok)
      throw new Problem(
        r.status >= 500 ? 503 : 422,
        "paypal_rejected",
        "PayPal rejected the request; reconcile original operation before retrying",
      );
    return r.status === 204 ? { status: "VOIDED" } : ((await r.json()) as Json);
  }
  private read(path: string, o: PayOptions = {}) {
    return this.request(path, "GET", undefined, undefined, o.merchantId);
  }
  createOrder(batchId: string, amount: number, key: string, o: PayOptions = {}) {
    const code: Currency = o.currency ?? "USD";
    return this.request(
      "/v2/checkout/orders",
      "POST",
      {
        intent: "AUTHORIZE",
        purchase_units: [
          {
            reference_id: batchId,
            custom_id: batchId,
            payee: { merchant_id: o.merchantId ?? this.config.merchantId },
            amount: { currency_code: code, value: paypalValue(amount, code) },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: withBatch(this.config.returnUrl, batchId),
              cancel_url: withBatch(this.config.cancelUrl, batchId),
              user_action: "CONTINUE",
            },
          },
        },
      },
      key,
      o.merchantId,
    );
  }
  authorizeOrder(orderId: string, key: string, o: PayOptions = {}) {
    return this.request(
      "/v2/checkout/orders/" + encodeURIComponent(orderId) + "/authorize",
      "POST",
      {},
      key,
      o.merchantId,
    );
  }
  getOrder(id: string, o: PayOptions = {}) {
    return this.read("/v2/checkout/orders/" + encodeURIComponent(id), o);
  }
  getAuthorization(id: string, o: PayOptions = {}) {
    return this.read("/v2/payments/authorizations/" + encodeURIComponent(id), o);
  }
  capture(
    authId: string,
    amount: number,
    key: string,
    details?: { invoice_id: string; note_to_payer: string },
    o: PayOptions = {},
  ) {
    const code: Currency = o.currency ?? "USD";
    return this.request(
      "/v2/payments/authorizations/" + encodeURIComponent(authId) + "/capture",
      "POST",
      {
        amount: { currency_code: code, value: paypalValue(amount, code) },
        final_capture: true,
        // The buyer's PayPal record carries the delivery summary and statement reference.
        ...(details
          ? {
              invoice_id: details.invoice_id.slice(0, 127),
              note_to_payer: details.note_to_payer.slice(0, 255),
            }
          : {}),
      },
      key,
      o.merchantId,
    );
  }
  getCapture(id: string, o: PayOptions = {}) {
    return this.read("/v2/payments/captures/" + encodeURIComponent(id), o);
  }
  void(authId: string, key: string, o: PayOptions = {}) {
    return this.request(
      "/v2/payments/authorizations/" + encodeURIComponent(authId) + "/void",
      "POST",
      {},
      key,
      o.merchantId,
    );
  }
  refund(captureId: string, amount: number, key: string, o: PayOptions = {}) {
    const code: Currency = o.currency ?? "USD";
    return this.request(
      "/v2/payments/captures/" + encodeURIComponent(captureId) + "/refund",
      "POST",
      { amount: { currency_code: code, value: paypalValue(amount, code) } },
      key,
      o.merchantId,
    );
  }
  getRefund(id: string, o: PayOptions = {}) {
    return this.read("/v2/payments/refunds/" + encodeURIComponent(id), o);
  }
  getDispute(id: string, o: PayOptions = {}) {
    return this.read("/v1/customer/disputes/" + encodeURIComponent(id), o);
  }
  // Partner onboarding: a sign-up link that lets a merchant connect their own PayPal
  // business account and grant this platform permission to take payments for them.
  createPartnerReferral(trackingId: string, returnUrl: string) {
    return this.request("/v2/customer/partner-referrals", "POST", {
      tracking_id: trackingId,
      operations: [
        {
          operation: "API_INTEGRATION",
          api_integration_preference: {
            rest_api_integration: {
              integration_method: "PAYPAL",
              integration_type: "THIRD_PARTY",
              third_party_details: {
                features: ["PAYMENT", "REFUND", "READ_SELLER_DISPUTE"],
              },
            },
          },
        },
      ],
      products: ["EXPRESS_CHECKOUT"],
      legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
      partner_config_override: { return_url: returnUrl },
    });
  }
  // Read-back of a connected merchant's status. The onboarding redirect is never trusted.
  getMerchantIntegration(merchantId: string) {
    return this.read(
      "/v1/customer/partners/" +
        encodeURIComponent(this.config.merchantId) +
        "/merchant-integrations/" +
        encodeURIComponent(merchantId),
    );
  }
  async verifyWebhook(headers: Record<string, string>, event: Json) {
    if (!this.config.webhookId) return false;
    const d = await this.request(
      "/v1/notifications/verify-webhook-signature",
      "POST",
      {
        auth_algo: headers["paypal-auth-algo"],
        cert_url: headers["paypal-cert-url"],
        transmission_id: headers["paypal-transmission-id"],
        transmission_sig: headers["paypal-transmission-sig"],
        transmission_time: headers["paypal-transmission-time"],
        webhook_id: this.config.webhookId,
        webhook_event: event,
      },
    );
    return d.verification_status === "SUCCESS";
  }
}
// Unsigned JWT that PayPal accepts as "acting for this merchant" from a partner app.
export function authAssertion(clientId: string, merchantId: string) {
  const b = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return b({ alg: "none" }) + "." + b({ iss: clientId, payer_id: merchantId }) + ".";
}
export function verifyMoney(
  resource: Json,
  expected: number,
  merchant: string,
  code: Currency = "USD",
) {
  const amount = resource.amount as
    | { currency_code?: string; value?: string }
    | undefined;
  const payee = resource.payee as { merchant_id?: string } | undefined;
  return sameMoney(amount, expected, code) && payee?.merchant_id === merchant;
}
