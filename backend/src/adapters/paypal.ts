import type { PayPal } from "../core/context.js";
import { Problem, unavailable } from "../core/errors.js";
import type { Json } from "../domain/contracts.js";
const base = "https://api-m.sandbox.paypal.com";
export const usd = (minor: number) => (minor / 100).toFixed(2);
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
    },
    private network: typeof fetch = fetch,
  ) {
    this.available = !!(config.clientId && config.secret && config.merchantId);
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
  private async request(
    path: string,
    method = "GET",
    body?: Json,
    key?: string,
  ): Promise<Json> {
    const r = await this.network(base + path, {
      method,
      headers: {
        authorization: "Bearer " + (await this.oauth()),
        "content-type": "application/json",
        ...(key ? { "PayPal-Request-Id": key } : {}),
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
  createOrder(batchId: string, amount: number, key: string) {
    return this.request(
      "/v2/checkout/orders",
      "POST",
      {
        intent: "AUTHORIZE",
        purchase_units: [
          {
            reference_id: batchId,
            custom_id: batchId,
            payee: { merchant_id: this.config.merchantId },
            amount: { currency_code: "USD", value: usd(amount) },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: this.config.returnUrl,
              cancel_url: this.config.cancelUrl,
              user_action: "CONTINUE",
            },
          },
        },
      },
      key,
    );
  }
  authorizeOrder(orderId: string, key: string) {
    return this.request(
      "/v2/checkout/orders/" + encodeURIComponent(orderId) + "/authorize",
      "POST",
      {},
      key,
    );
  }
  getOrder(id: string) {
    return this.request("/v2/checkout/orders/" + encodeURIComponent(id));
  }
  getAuthorization(id: string) {
    return this.request(
      "/v2/payments/authorizations/" + encodeURIComponent(id),
    );
  }
  capture(
    authId: string,
    amount: number,
    key: string,
    details?: { invoice_id: string; note_to_payer: string },
  ) {
    return this.request(
      "/v2/payments/authorizations/" + encodeURIComponent(authId) + "/capture",
      "POST",
      {
        amount: { currency_code: "USD", value: usd(amount) },
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
    );
  }
  getCapture(id: string) {
    return this.request("/v2/payments/captures/" + encodeURIComponent(id));
  }
  void(authId: string, key: string) {
    return this.request(
      "/v2/payments/authorizations/" + encodeURIComponent(authId) + "/void",
      "POST",
      {},
      key,
    );
  }
  refund(captureId: string, amount: number, key: string) {
    return this.request(
      "/v2/payments/captures/" + encodeURIComponent(captureId) + "/refund",
      "POST",
      { amount: { currency_code: "USD", value: usd(amount) } },
      key,
    );
  }
  getRefund(id: string) {
    return this.request("/v2/payments/refunds/" + encodeURIComponent(id));
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
export function verifyMoney(
  resource: Json,
  expected: number,
  merchant: string,
) {
  const amount = resource.amount as
    | { currency_code?: string; value?: string }
    | undefined;
  const payee = resource.payee as { merchant_id?: string } | undefined;
  return (
    amount?.currency_code === "USD" &&
    amount.value === usd(expected) &&
    payee?.merchant_id === merchant
  );
}
