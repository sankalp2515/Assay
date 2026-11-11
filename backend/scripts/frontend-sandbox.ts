import "./config.js";
import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness } from "../test/harness.js";
import { dispatchOutbox } from "../src/core/transport.js";
import { PayPalSandbox } from "../src/adapters/paypal.js";
import { configuredInvestigator } from "../src/adapters/models.js";
import type { Batch } from "../src/domain/contracts.js";

// Loopback UI runner with REAL PayPal Sandbox and a REAL hosted model.
// Media is still seeded locally (no video provider is configured), and is labeled as such.
// The buyer agreement, PayPal order, approval and authorization all happen through the UI:
// this script never consents, never creates an order and never approves anything.
const demo = JSON.parse(await readFile(".local/demo.json", "utf8")) as {
  tenant_id: string;
  buyer_id: string;
};
const publicKeys = JSON.parse(
  await readFile(".local/public-keys.json", "utf8"),
) as Record<string, string>;
if (!publicKeys.operator) throw new Error("Run npm run provision first");
for (const name of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_MERCHANT_ID"])
  if (!process.env[name])
    throw new Error(name + " is missing from backend/.env");

process.env.BUYER_RETURN_BASE ??= "http://localhost:5180";
const commercePort = Number(process.env.FIXTURE_COMMERCE_PORT ?? 4300);
const deliveryPort = Number(process.env.FIXTURE_DELIVERY_PORT ?? 4302);
let artifactDir: string | undefined;
if (process.env.FIXTURE_SOURCE_MP4) {
  artifactDir = await mkdtemp(join(tmpdir(), "pvd-sandbox-media-"));
  await copyFile(process.env.FIXTURE_SOURCE_MP4, join(artifactDir, "source.mp4"));
}
const h = await harness({
  tenant: demo.tenant_id,
  buyer: demo.buyer_id,
  ...(artifactDir ? { artifactDir } : {}),
});

try {
  const model = configuredInvestigator(process.env);
  if (!model.available)
    throw new Error("A configured, confirmed free-tier AI provider is required");
  for (const ctx of Object.values(h.contexts)) {
    ctx.fixture = false;
    ctx.merchantId = process.env.PAYPAL_MERCHANT_ID ?? "";
  }
  h.contexts.payments.paypal = new PayPalSandbox({
    clientId: process.env.PAYPAL_CLIENT_ID ?? "",
    secret: process.env.PAYPAL_CLIENT_SECRET ?? "",
    merchantId: process.env.PAYPAL_MERCHANT_ID ?? "",
    webhookId: "",
    returnUrl: `http://localhost:${commercePort}/v1/paypal/return`,
    cancelUrl: `http://localhost:${commercePort}/v1/paypal/cancel`,
  });
  h.contexts.investigation.model = model;

  const created = await h.request("/v1/batches", {
    buyer_id: h.buyer,
    title: process.env.SANDBOX_DELIVERY_TITLE ?? "Coastal collection",
    unit_count: 10,
    unit_price_minor: 500,
    currency: "USD",
    prompt: "Seeded demonstration media; no paid inference is submitted.",
  });
  if (created.statusCode !== 200) throw new Error(created.body);
  const batch = created.json<Batch>();

  h.identities.operator.publicKeys.operator = publicKeys.operator;
  await h.apps.commerce.listen({ host: "127.0.0.1", port: commercePort });
  await h.apps.delivery.listen({ host: "127.0.0.1", port: deliveryPort });

  // Once the real authorization is confirmed, stage the delivery the story needs:
  // eight finished clips, the eighth archived but never published to the buyer.
  let seeded = false,
    busy = false;
  const worker = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      for (const ctx of Object.values(h.contexts))
        await dispatchOutbox(ctx, h.tenant);
      if (!seeded) {
        const current = await h.contexts.commerce.db.get<Batch>(
          h.tenant,
          "batch",
          batch.id,
        );
        if (current?.state === "AUTHORIZED") {
          seeded = true;
          const artifacts = await h.seed(current, 8, true);
          await h.contexts.delivery.db.mutate(
            h.tenant,
            "artifact",
            String(artifacts[7]!.id),
            async (a) => ({ ...a, published: false }),
          );
          console.log(JSON.stringify({ event: "authorized_media_seeded", clips: 8, unpublished: 1 }));
        }
      }
    } catch (error) {
      console.error("Sandbox worker iteration failed", error instanceof Error ? error.message : "");
    } finally {
      busy = false;
    }
  }, 500);
  worker.unref();

  console.log(
    JSON.stringify(
      {
        environment: "sandbox",
        paypal: "REAL PayPal Sandbox (orders, authorization, capture)",
        ai: "real hosted model",
        media: artifactDir ? "seeded from FIXTURE_SOURCE_MP4" : "encoded test card",
        commerce: "http://127.0.0.1:" + commercePort,
        delivery: "http://127.0.0.1:" + deliveryPort,
        batch_id: batch.id,
        next: "Open the buyer agreement in the UI, consent, and approve the order in PayPal Sandbox.",
      },
      null,
      2,
    ),
  );
  async function stop() {
    clearInterval(worker);
    await h.close();
  }
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
} catch (error) {
  await h.close();
  throw error;
}
