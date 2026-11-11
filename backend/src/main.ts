import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createApp } from "./app.js";
import { embedded, postgres } from "./core/database.js";
import { httpTransport, dispatchOutbox } from "./core/transport.js";
import { maintain } from "./core/maintenance.js";
import { PayPalSandbox } from "./adapters/paypal.js";
import { GeminiInvestigator } from "./adapters/gemini.js";
import { configuredInvestigator } from "./adapters/models.js";
import { Runway } from "./adapters/runway.js";
import { services, type Service } from "./domain/contracts.js";
import type { Context } from "./core/context.js";
const name = process.env.SERVICE_NAME as Service;
if (!services.includes(name))
  throw new Error("SERVICE_NAME must name one of the five services");
const privateKey =
  process.env.SERVICE_PRIVATE_KEY ??
  (await readFile(resolve(".local/keys", name + ".pem"), "utf8"));
const publicKeys = JSON.parse(
  process.env.PUBLIC_KEYS ??
    (await readFile(".local/public-keys.json", "utf8")),
) as Record<string, string>;
const urls = JSON.parse(process.env.SERVICE_URLS ?? "{}") as Record<
  Service,
  string
>;
for (const [i, s] of services.entries())
  urls[s] ??= "http://127.0.0.1:" + (4100 + i);
const identity = {
  name,
  privateKey,
  publicKeys,
  keyId: process.env.SERVICE_KEY_ID,
  verificationKeys: process.env.PUBLIC_KEY_REGISTRY
    ? (JSON.parse(process.env.PUBLIC_KEY_REGISTRY) as Record<
        string,
        { issuer: string; pem: string }
      >)
    : undefined,
};
const db = process.env.DATABASE_URL
  ? postgres(process.env.DATABASE_URL)
  : await embedded(resolve(".local/data", name));
if (process.env.AUTO_MIGRATE === "true") await db.migrate(name);
const ctx: Context = {
  name,
  db,
  identity,
  call: httpTransport(identity, urls),
  artifactDir: process.env.ARTIFACT_DIR ?? resolve(".local/artifacts"),
  allowPaid: process.env.ALLOW_PAID_INFERENCE === "true",
  maxAttempts: Number(process.env.MAX_PROVIDER_ATTEMPTS ?? 1),
  merchantId: process.env.PAYPAL_MERCHANT_ID ?? "",
  publicOrigin: process.env.PUBLIC_ORIGIN ?? "http://localhost:4100",
  fixture: false,
  now: Date.now,
};
if (name === "payments")
  ctx.paypal = new PayPalSandbox({
    clientId: process.env.PAYPAL_CLIENT_ID ?? "",
    secret: process.env.PAYPAL_CLIENT_SECRET ?? "",
    merchantId: ctx.merchantId,
    webhookId: process.env.PAYPAL_WEBHOOK_ID ?? "",
    returnUrl:
      process.env.PAYPAL_RETURN_URL ?? "http://localhost:4100/v1/paypal/return",
    cancelUrl:
      process.env.PAYPAL_CANCEL_URL ?? "http://localhost:4100/v1/paypal/cancel",
  });
if (name === "investigation") ctx.model = configuredInvestigator(process.env);
if (name === "provider")
  ctx.provider = new Runway(
    process.env.RUNWAY_API_KEY ?? "",
    process.env.RUNWAY_MODEL ?? "gen4.5",
  );
const app = await createApp(ctx);
let busy = false;
let stopping = false;
let currentIteration: Promise<void> | undefined;
const tenants = (process.env.TENANT_IDS ?? "").split(",").filter(Boolean);
let iterations = 0;
async function iterate() {
  busy = true;
  try {
    for (const tenant of tenants) {
      if (stopping) break;
      await dispatchOutbox(ctx, tenant);
      if (iterations % 60 === 0) await maintain(ctx, tenant);
    }
    iterations++;
  } catch {
    console.warn(
      JSON.stringify({
        service: name,
        event: "worker_iteration_failed",
        at: new Date().toISOString(),
      }),
    );
  } finally {
    busy = false;
  }
}
const timer = setInterval(() => {
  if (busy || stopping) return;
  currentIteration = iterate();
}, 500);
await app.listen({
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 4100),
});
console.log(
  JSON.stringify({
    service: name,
    port: Number(process.env.PORT ?? 4100),
    environment: "sandbox",
    status: "listening",
  }),
);
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  // Stop accepting requests and let the bounded in-flight dispatch finish before DB close.
  await app.close();
  await currentIteration;
  await db.close();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
