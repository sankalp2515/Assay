// Registers (or finds) this deployment's PayPal Sandbox webhook and prints its id.
// The id is account configuration, not a secret; credentials stay in backend/.env.
//   WEBHOOK_URL=https://<domain>/v1/paypal/webhooks npx tsx scripts/register-paypal-webhook.ts
import "./config.js";

const url = process.env.WEBHOOK_URL ?? "";
if (!/^https:\/\/[^/]+\/v1\/paypal\/webhooks$/.test(url)) throw new Error("Set WEBHOOK_URL to https://<domain>/v1/paypal/webhooks");
const base = "https://api-m.sandbox.paypal.com";
const auth = Buffer.from((process.env.PAYPAL_CLIENT_ID ?? "") + ":" + (process.env.PAYPAL_CLIENT_SECRET ?? "")).toString("base64");
const tok = await fetch(base + "/v1/oauth2/token", {
  method: "POST",
  headers: { authorization: "Basic " + auth, "content-type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials",
});
if (!tok.ok) throw new Error("PayPal OAuth failed: " + tok.status);
const { access_token } = (await tok.json()) as { access_token: string };
const h = { authorization: "Bearer " + access_token, "content-type": "application/json" };
const events = [
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.REFUNDED",
  "CUSTOMER.DISPUTE.CREATED",
  "CUSTOMER.DISPUTE.UPDATED",
  "CUSTOMER.DISPUTE.RESOLVED",
];
const list = (await (await fetch(base + "/v1/notifications/webhooks", { headers: h })).json()) as {
  webhooks?: { id: string; url: string }[];
};
let hook = list.webhooks?.find((w) => w.url === url);
if (!hook) {
  const r = await fetch(base + "/v1/notifications/webhooks", {
    method: "POST",
    headers: h,
    body: JSON.stringify({ url, event_types: events.map((name) => ({ name })) }),
  });
  const body = (await r.json()) as { id?: string; name?: string; message?: string };
  if (!r.ok || !body.id) throw new Error("Webhook registration failed: " + r.status + " " + (body.name ?? "") + " " + (body.message ?? ""));
  hook = { id: body.id, url };
}
console.log(JSON.stringify({ webhook_id: hook.id, url: hook.url, events: events.length }));
