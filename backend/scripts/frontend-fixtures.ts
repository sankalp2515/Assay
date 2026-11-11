import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness } from "../test/harness.js";
import { dispatchOutbox } from "../src/core/transport.js";

// Loopback development service for UI work. Uses the test harness exclusively.
const demo = JSON.parse(await readFile(".local/demo.json", "utf8")) as {
  tenant_id: string;
  buyer_id: string;
};
const publicKeys = JSON.parse(
  await readFile(".local/public-keys.json", "utf8"),
) as Record<string, string>;
if (!publicKeys.operator) throw new Error("Run npm run provision first");
// Optional dev-only overrides. FIXTURE_SOURCE_MP4 seeds every fixture unit from one
// existing local file (for example the actual LTX clip) instead of the encoded test card.
// It changes media bytes only; AI and PayPal stay fixtures and are labeled as such.
const commercePort = Number(process.env.FIXTURE_COMMERCE_PORT ?? 4200);
const deliveryPort = Number(process.env.FIXTURE_DELIVERY_PORT ?? 4202);
let artifactDir: string | undefined;
if (process.env.FIXTURE_SOURCE_MP4) {
  artifactDir = await mkdtemp(join(tmpdir(), "pvd-fixture-media-"));
  await copyFile(process.env.FIXTURE_SOURCE_MP4, join(artifactDir, "source.mp4"));
}
const h = await harness({
  tenant: demo.tenant_id,
  buyer: demo.buyer_id,
  ...(artifactDir ? { artifactDir } : {}),
});
if (process.argv.includes("--real-ai")) {
  await import("./config.js");
  const { configuredInvestigator } = await import("../src/adapters/models.js");
  h.contexts.investigation.model = configuredInvestigator(process.env);
  if (!h.contexts.investigation.model.available)
    throw Error("A configured, confirmed free-tier AI provider is required");
}

try {
  const scenario = process.argv[2] ?? "recovery";
  if (!["recovery", "partial", "zero", "partial-recovery"].includes(scenario))
    throw new Error("Choose recovery, partial, partial-recovery or zero");
  const batch = await h.setup(scenario.startsWith("partial") ? 10 : 1);
  if (scenario === "recovery") await h.seed(batch, 1, false);
  if (scenario === "partial") await h.seed(batch, 8, true);
  if(scenario === "partial-recovery") {
    const artifacts=await h.seed(batch,8,true);
    await h.contexts.delivery.db.mutate(h.tenant,"artifact",String(artifacts[7]!.id),async a=>({...a,published:false}));
  }

  // Trust the local dev issuer only after setup. No browser or endpoint receives its key.
  h.identities.operator.publicKeys.operator = publicKeys.operator;
  await h.apps.commerce.listen({ host: "127.0.0.1", port: commercePort });
  await h.apps.delivery.listen({ host: "127.0.0.1", port: deliveryPort });

  let draining = false;
  const worker = setInterval(async () => {
    if (draining) return;
    draining = true;
    try {
      for (const ctx of Object.values(h.contexts))
        await dispatchOutbox(ctx, h.tenant);
    } catch {
      console.error("Fixture worker iteration failed");
    } finally {
      draining = false;
    }
  }, 250);
  worker.unref();
  console.log(
    JSON.stringify(
      {
        environment: "fixture",
        ai: process.argv.includes("--real-ai")
          ? "real hosted model over fixture observations"
          : "deterministic fixture",
        commerce: "http://127.0.0.1:" + commercePort,
        delivery: "http://127.0.0.1:" + deliveryPort,
        scenario,
        media: artifactDir ? "seeded from FIXTURE_SOURCE_MP4" : "encoded test card",
        batch_id: batch.id,
        tokens: "npm run token -- operator or npm run token -- buyer",
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
