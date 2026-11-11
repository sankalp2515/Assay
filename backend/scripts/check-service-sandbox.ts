import "./config.js";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  access,
  readdir,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { embedded } from "../src/core/database.js";
import { setTimeout as delay } from "node:timers/promises";
import { harness } from "../test/harness.js";
import { PayPalSandbox } from "../src/adapters/paypal.js";
import { configuredInvestigator } from "../src/adapters/models.js";
import { id, digest, type Batch, type Json } from "../src/domain/contracts.js";
await mkdir(".local", { recursive: true });
const resume = process.argv.includes("--resume")
  ? JSON.parse(await readFile(".local/service-sandbox-approval.json", "utf8"))
  : undefined;
const dir =
  resume?.run_dir ?? (await mkdtemp(resolve(".local/service-sandbox-")));
let savedBatch: Batch | undefined,
  savedTenant: string | undefined,
  savedArtifactDir: string | undefined;
if (resume) {
  assert.equal(
    JSON.parse(await readFile(join(dir, "result.json"), "utf8")).phase,
    "investigate_recover",
    "Only pre-settlement investigation failure can auto-resume",
  );
  const commerce = await embedded(join(dir, "databases", "commerce"));
  try {
    const rows = await commerce.maintenanceTx((q) =>
      q.query(
        "SELECT tenant_id,body FROM entities WHERE kind='batch' AND id=$1",
        [resume.batch_id],
      ),
    );
    assert.equal(rows.rows.length, 1);
    savedBatch = rows.rows[0]!.body as Batch;
    savedTenant = String(rows.rows[0]!.tenant_id);
  } finally {
    await commerce.close();
  }
  const delivery = await embedded(join(dir, "databases", "delivery"));
  let stored: Json[];
  try {
    stored = await delivery.list(savedTenant!, "artifact", savedBatch!.id);
  } finally {
    await delivery.close();
  }
  for (const entry of await readdir(tmpdir(), { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("paypal-backend-test-"))
      continue;
    try {
      await access(join(tmpdir(), entry.name, String(stored[0]!.id) + ".mp4"));
      savedArtifactDir = join(tmpdir(), entry.name);
      break;
    } catch {}
  }
  assert.ok(
    savedArtifactDir,
    "Original fixture bytes must be recovered, never fabricated on resume",
  );
}
const h = await harness({
  dataRoot: join(dir, "databases"),
  artifactDir: savedArtifactDir,
  tenant: savedTenant,
  buyer: savedBatch?.buyer_id,
});
const paypal = new PayPalSandbox({
  clientId: process.env.PAYPAL_CLIENT_ID ?? "",
  secret: process.env.PAYPAL_CLIENT_SECRET ?? "",
  merchantId: process.env.PAYPAL_MERCHANT_ID ?? "",
  webhookId: "",
  returnUrl: "http://localhost:4100/v1/paypal/return",
  cancelUrl: "http://localhost:4100/v1/paypal/cancel",
});
await writeFile(
  join(dir, "identities-" + id() + ".json"),
  JSON.stringify(h.identities),
  { mode: 0o600 },
);
let phase = "create";
try {
  for (const ctx of Object.values(h.contexts)) {
    ctx.fixture = false;
    ctx.merchantId = process.env.PAYPAL_MERCHANT_ID ?? "";
  }
  h.contexts.payments.paypal = paypal;
  h.contexts.investigation.model = configuredInvestigator(process.env);
  let batch: Batch;
  if (!savedBatch) {
    const created = await h.request("/v1/batches", {
      buyer_id: h.buyer,
      unit_count: 10,
      unit_price_minor: 500,
      currency: "USD",
      prompt: "Explicit integration fixture; never submit paid inference.",
    });
    assert.equal(created.statusCode, 200);
    batch = created.json<Batch>();
    const base = "/v1/batches/" + batch.id;
    assert.equal(
      (
        await h.request(
          base + "/consent",
          { contract_hash: batch.contract_hash },
          "buyer",
        )
      ).statusCode,
      200,
    );
    const response = await h.request(base + "/paypal/order", {}, "buyer");
    assert.equal(response.statusCode, 200);
    const order = response.json<Json>();
    assert.equal(order.state, "CREATED");
    await writeFile(
      ".local/service-sandbox-approval.json",
      JSON.stringify({
        approval_url: order.approval_url,
        run_dir: dir,
        batch_id: batch.id,
        marker: join(dir, "approved.signal"),
      }),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        phase: "awaiting_actual_sandbox_buyer_approval",
        handoff: ".local/service-sandbox-approval.json",
        video_provenance:
          "local deterministic MP4 fixtures; no Runway generation",
      }),
    );
    phase = "buyer_approval";
    const deadline = Date.now() + 600000;
    while (Date.now() < deadline) {
      try {
        await access(join(dir, "approved.signal"));
        break;
      } catch {
        await delay(1000);
      }
    }
    await access(join(dir, "approved.signal"));
    phase = "authorize";
    const authorized = await h.request(base + "/paypal/authorize", {}, "buyer");
    assert.equal(authorized.statusCode, 200);
    assert.equal(authorized.json().state, "AUTHORIZED");
  } else {
    batch = savedBatch;
    assert.equal(
      (await h.contexts.payments.db.list(h.tenant, "operation")).length,
      0,
      "Existing financial intent requires reconciliation, not a new permit",
    );
    const auth = await h.contexts.payments.db.get<Json>(
      h.tenant,
      "authorization",
      batch.id,
    );
    assert.equal(auth?.state, "AUTHORIZED");
    assert.equal(
      (await paypal.getAuthorization(String(auth!.provider_id))).status,
      "CREATED",
    );
  }
  const base = "/v1/batches/" + batch.id;
  phase = "fixture_archive";
  const artifacts = resume
    ? await h.contexts.delivery.db.list<Json>(h.tenant, "artifact", batch.id)
    : await h.seed(batch, 8, true);
  const failedUnits = new Set(batch.units.slice(8).map((u) => u.id));
  if (!resume)
    for (const unit of batch.units.slice(8)) {
      const attempt = {
        id: id(),
        batch_id: batch.id,
        unit_id: unit.id,
        state: "FAILED",
        provider_task_id: "TASK_" + unit.id,
      };
      await h.contexts.provider.db.create(
        h.tenant,
        "attempt",
        attempt.id,
        attempt,
        attempt,
      );
    }
  h.contexts.provider.provider!.lookup = async (task) => ({
    id: task,
    status: failedUnits.has(task.replace(/^TASK_/, ""))
      ? "FAILED"
      : "SUCCEEDED",
    output: [],
  });
  if (!resume)
    await h.contexts.delivery.db.mutate(
      h.tenant,
      "artifact",
      String(artifacts[0]!.id),
      async (old) => ({ ...old, published: false }),
    );
  const missing = artifacts.find((a) => a.published === false);
  assert.ok(missing);
  phase = "investigate_recover";
  const diagnosis = (
    await h.request(
      base + "/investigate",
      resume
        ? {
            refresh_reason:
              "Clarified model action semantics; reconsider existing archive recovery without changing financial authority.",
          }
        : {},
    )
  ).json<Json>();
  assert.equal(diagnosis.state, "VALID");
  assert.equal(diagnosis.provenance, "real");
  const recovery = await h.request(base + "/recover", {
    artifact_id: missing.id,
    assessment_id: diagnosis.id,
  });
  assert.equal(recovery.statusCode, 200);
  phase = "review_settle";
  const settlement = await h.settle(batch);
  assert.equal(settlement.permit.amount_minor, 4000);
  const result = await settlement.execute();
  assert.equal(result.state, "CONFIRMED");
  assert.equal(result.amount_minor, 4000);
  const journal = await h.contexts.payments.db.tx(h.tenant, (q) =>
    q.query(
      "SELECT event_kind,amount_minor,resource_digest FROM financial_journal",
    ),
  );
  assert.equal(journal.rows.length, 1);
  assert.equal(journal.rows[0]!.event_kind, "CAPTURE");
  assert.equal(Number(journal.rows[0]!.amount_minor), 4000);
  const report = {
    at: new Date().toISOString(),
    passed: true,
    actual_ai: true,
    model: diagnosis.model,
    actual_paypal_sandbox: true,
    actual_provider_generation: false,
    video_provenance:
      "Eight deterministic local MP4 fixtures; two fixture failed tasks",
    api_transport:
      "authenticated in-process Fastify injection across five domains",
    database: "five separate persistent local PGlite databases",
    recovered_original_fixture: true,
    authorized_minor: 5000,
    captured_minor: 4000,
    unused_authorization_minor: 1000,
    journal_receipt_digest: journal.rows[0]!.resource_digest,
    contract_digest: digest(batch.contract_hash),
    limitations: [
      "not actual video-provider output",
      "not separate-process HTTP e2e",
      "no actual signed webhook delivery",
      "not commercial production validation",
    ],
  };
  await writeFile(
    "evidence/service-sandbox-workflow.json",
    JSON.stringify(report, null, 2),
  );
  await writeFile(
    join(dir, "result.json"),
    JSON.stringify({ phase: "complete", ...report }),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
} catch {
  await writeFile(
    join(dir, "result.json"),
    JSON.stringify({
      phase,
      status: "incomplete",
      private_databases_preserved: true,
    }),
    { mode: 0o600 },
  );
  console.error(
    JSON.stringify({
      status: "incomplete",
      phase,
      private_state_preserved: true,
      no_new_write_identity_retry: true,
    }),
  );
  process.exitCode = 1;
} finally {
  await h.close();
}
