import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "./context.js";
import type { Sql } from "./database.js";
import { Problem } from "./errors.js";
import type { Json, Service } from "../domain/contracts.js";

// Signed events to the merchant's own system, so their app learns that a clip was
// recovered or a batch settled without polling. Events ride the transactional outbox:
// written in the same database transaction as the state change, retried with backoff,
// and delivered at least once. Consumers dedupe on the event `id`.
export const WEBHOOK_TARGET = "merchant";
export type WebhookEvent =
  | "clip.recovered"
  | "batch.settled"
  | "batch.voided"
  | "dispute.opened"
  | "dispute.updated"
  | "dispute.resolved";

function target() {
  const raw = process.env.MERCHANT_WEBHOOK_URL ?? "";
  const secret = process.env.MERCHANT_WEBHOOK_SECRET ?? "";
  if (!raw || secret.length < 32) return undefined;
  const url = new URL(raw);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    throw new Error("MERCHANT_WEBHOOK_URL must be https");
  if (url.username || url.password) throw new Error("No credentials in MERCHANT_WEBHOOK_URL");
  return { url, secret };
}

export async function emitEvent(
  ctx: Context,
  q: Sql,
  tenant: string,
  type: WebhookEvent,
  eventId: string,
  data: Json,
) {
  if (!target()) return;
  await ctx.db.enqueue(q, tenant, WEBHOOK_TARGET as Service, "/" + type, {
    id: eventId,
    type,
    created_at: new Date(ctx.now()).toISOString(),
    data,
  });
}

export function sign(secret: string, timestamp: number, raw: string) {
  return createHmac("sha256", secret).update(timestamp + "." + raw).digest("hex");
}

// For merchants (and tests): verify `Assay-Signature: t=<unix>,v1=<hex>` over the raw body.
export function verifyWebhook(
  secret: string,
  header: string,
  raw: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
) {
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.trim().split("=") as [string, string]),
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = Buffer.from(sign(secret, t, raw), "hex");
  const given = Buffer.from(String(parts.v1 ?? ""), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function deliverWebhook(body: Json, network: typeof fetch = fetch) {
  const t = target();
  if (!t) throw new Problem(410, "webhook_unconfigured", "Merchant webhook removed");
  const raw = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const r = await network(t.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "assay-event-id": String(body.id),
      "assay-event-type": String(body.type),
      "assay-signature": "t=" + timestamp + ",v1=" + sign(t.secret, timestamp, raw),
    },
    body: raw,
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  if (!r.ok)
    throw new Problem(
      r.status >= 500 || r.status === 429 ? 503 : r.status,
      "webhook_rejected",
      "Merchant endpoint rejected the event",
    );
}
