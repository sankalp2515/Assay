import "./config.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { harness } from "../test/harness.js";
import { token } from "../src/core/auth.js";
import { dispatchOutbox } from "../src/core/transport.js";
import { PayPalSandbox } from "../src/adapters/paypal.js";
import { configuredInvestigator } from "../src/adapters/models.js";
import { downloadOutput, isolatedVerification } from "../src/adapters/media.js";
import { embedded } from "../src/core/database.js";
import type { Batch, Json } from "../src/domain/contracts.js";

const host = "lightricks-ltx-video-distilled.hf.space";
const job = JSON.parse(await readFile(".local/ltx-distilled/run.json", "utf8"));
const completed = JSON.parse(
  await readFile(".local/ltx-distilled/result.json", "utf8"),
);
assert.equal(completed.event, "complete");
assert.match(job.event_id, /^[a-zA-Z0-9_-]{1,100}$/);
const output = new URL(completed.data[0].video.url);
assert.equal(output.origin, "https://" + host);
assert.ok(
  output.pathname.startsWith("/gradio_api/file=") ||
    output.pathname.startsWith("/file="),
);
const fixturePayments = process.argv.includes("--fixture-paypal");
const resume = process.argv.includes("--resume")
  ? (JSON.parse(
      await readFile(".local/generated-video-approval.json", "utf8"),
    ) as { marker: string })
  : undefined;
assert.ok(!resume || !fixturePayments);
const dir = resume
  ? dirname(resolve(resume.marker))
  : await mkdtemp(resolve(".local/generated-video-sandbox-"));
let previous: { tenant_id: string; body: Batch } | undefined;
if (resume) {
  assert.equal(dirname(dir), resolve(".local"));
  assert.ok(basename(dir).startsWith("generated-video-sandbox-"));
  const failure = JSON.parse(await readFile(join(dir, "failure.json"), "utf8"));
  assert.equal(
    failure.phase,
    "buyer_approval",
    "Only approval timeout can resume automatically",
  );
  const commerce = await embedded(join(dir, "db", "commerce"));
  try {
    const saved = await commerce.maintenanceTx((q) =>
      q.query<{ tenant_id: string; body: Batch }>(
        "SELECT tenant_id,body FROM entities WHERE kind='batch'",
      ),
    );
    assert.equal(saved.rows.length, 1);
    previous = saved.rows[0]!;
  } finally {
    await commerce.close();
  }
}
const original = join(dir, "original.mp4");
if (!resume) await downloadOutput(output.href, original, [host]);
const media = await isolatedVerification(original);
await writeFile(
  "evidence/generated-video.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      provider: "Lightricks public LTX Video Distilled Space",
      actual_generated_video: true,
      generation_requests: 1,
      existing_result_downloaded: true,
      paid_api_used: false,
      media,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    phase: "actual_video_verified",
    media,
    private_clip: original,
  }),
);
if (process.argv.includes("--media-only")) process.exit(0);

const model = configuredInvestigator({
  ...process.env,
  AI_ZERO_COST_ONLY: "true",
});
const paypal = new PayPalSandbox({
  clientId: process.env.PAYPAL_CLIENT_ID ?? "",
  secret: process.env.PAYPAL_CLIENT_SECRET ?? "",
  merchantId: process.env.PAYPAL_MERCHANT_ID ?? "",
  webhookId: "",
  returnUrl: "http://localhost:4100/v1/paypal/return",
  cancelUrl: "http://localhost:4100/v1/paypal/cancel",
});
assert.ok((fixturePayments || paypal.available) && model.available);
const artifacts = join(dir, "artifacts");
await mkdir(artifacts, { recursive: true });
const h = await harness({
  dataRoot: join(dir, "db"),
  artifactDir: artifacts,
  tenant: previous?.tenant_id,
  buyer: previous?.body.buyer_id,
});
let phase = "order";
try {
  if (!fixturePayments) {
    for (const ctx of Object.values(h.contexts)) {
      ctx.fixture = false;
      ctx.merchantId = process.env.PAYPAL_MERCHANT_ID ?? "";
    }
    h.contexts.payments.paypal = paypal;
  }
  h.contexts.investigation.model = model;
  // Integration-only bridge for this completed Gradio result. No public import API.
  h.contexts.provider.provider = {
    available: true,
    lookup: async (id) => {
      assert.equal(id, job.event_id);
      return { id, status: "SUCCEEDED", output: [output.href] };
    },
    submit: async () => {
      throw new Error("This integration must never regenerate the clip");
    },
  };
  process.env.RUNWAY_ALLOWED_HOSTS = host; // this process only; the runtime Runway policy is unchanged
  let batch: Batch;
  if (previous) {
    batch = previous.body;
    phase = "buyer_approval";
    const savedOrder = await h.contexts.payments.db.get<Json>(
      h.tenant,
      "order",
      batch.id,
    );
    assert.ok(savedOrder?.provider_id);
    assert.equal(
      (await paypal.getOrder(String(savedOrder.provider_id))).status,
      "APPROVED",
    );
    assert.equal(
      (await h.contexts.payments.db.list(h.tenant, "operation", batch.id))
        .length,
      0,
    );
    assert.equal(
      await h.contexts.payments.db.get(h.tenant, "authorization", batch.id),
      undefined,
    );
  } else {
    const created = await h.request("/v1/batches", {
      buyer_id: h.buyer,
      unit_count: 1,
      unit_price_minor: 500,
      currency: "USD",
      prompt: job.prompt,
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
    const order = (
      await h.request(base + "/paypal/order", {}, "buyer")
    ).json<Json>();
    assert.equal(order.state, "CREATED");
    if (!fixturePayments) {
      const marker = join(dir, "approved.signal");
      await writeFile(
        ".local/generated-video-approval.json",
        JSON.stringify({ approval_url: order.approval_url, marker }),
        { mode: 0o600 },
      );
      phase = "buyer_approval";
      console.log(
        "Sandbox buyer approval ready in .local/generated-video-approval.json",
      );
      const deadline = Date.now() + 300000;
      while (Date.now() < deadline) {
        try {
          await access(marker);
          break;
        } catch {
          await delay(1000);
        }
      }
      await access(marker);
    }
  }
  const base = "/v1/batches/" + batch.id;
  phase = "authorize";
  assert.equal(
    (await h.request(base + "/paypal/authorize", {}, "buyer")).json().state,
    "AUTHORIZED",
  );
  phase = "archive";
  const attempt = (
    await h.request(base + "/attempts", {
      unit_id: batch.units[0]!.id,
      provider_task_id: job.event_id,
    })
  ).json<Json>();
  assert.equal(attempt.state, "SUCCEEDED");
  const stored = (
    await h.request(base + "/preserve", { attempt_id: attempt.id })
  ).json<Json>();
  assert.equal(stored.state, "STORED");
  assert.equal(stored.sha256, media.sha256);
  assert.equal(stored.published, false);
  phase = "investigation_and_recovery";
  const diagnosis = (await h.request(base + "/investigate", {})).json<Json>();
  assert.equal(diagnosis.state, "VALID");
  assert.equal(diagnosis.provenance, "real");
  assert.equal(
    (
      await h.request(base + "/recover", {
        artifact_id: stored.id,
        assessment_id: diagnosis.id,
      })
    ).statusCode,
    200,
  );
  const bearer = await token(
    h.identities.commerce,
    "delivery",
    h.tenant,
    "buyer",
    h.buyer,
  );
  const content = await h.apps.delivery.inject({
    url: "/v1/artifacts/" + stored.id + "/content",
    headers: { authorization: "Bearer " + bearer },
  });
  assert.equal(content.statusCode, 200);
  assert.equal(
    createHash("sha256").update(content.rawPayload).digest("hex"),
    media.sha256,
  );
  phase = "settlement";
  const current = (await h.request(base + "/investigate", {})).json<Json>();
  assert.equal(current.state, "VALID");
  const preview = (await h.request(base + "/closure-preview", {})).json<Json>();
  assert.equal(preview.amount_minor, 500);
  const approved = (
    await h.request(base + "/approve", {
      proposal_id: preview.id,
      approval_digest: preview.approval_digest,
    })
  ).json<Json>();
  assert.equal(approved.state, "SETTLEMENT_REQUESTED");
  for (let round = 0; round < 4; round++) {
    await dispatchOutbox(h.contexts.commerce, h.tenant);
    await dispatchOutbox(h.contexts.payments, h.tenant);
  }
  const ledger = await h.contexts.payments.db.tx(h.tenant, (q) =>
    q.query(
      "SELECT event_kind,amount_minor,resource_digest FROM financial_journal",
    ),
  );
  assert.equal(ledger.rows.length, 1);
  assert.equal(ledger.rows[0]!.event_kind, "CAPTURE");
  assert.equal(Number(ledger.rows[0]!.amount_minor), 500);
  const report = {
    at: new Date().toISOString(),
    passed: true,
    provider: "Lightricks LTX Video Distilled ZeroGPU",
    actual_generated_video: true,
    provider_result_bridge:
      "completed Gradio result supplied to isolated integration harness",
    actual_ai: true,
    model: diagnosis.model,
    actual_paypal_sandbox: !fixturePayments,
    payment_provenance: fixturePayments
      ? "explicit test fixture"
      : "actual PayPal Sandbox",
    real_money: false,
    archive_and_buyer_sha256: media.sha256,
    media,
    authorized_minor: 500,
    captured_minor: 500,
    journal_receipt_digest: ledger.rows[0]!.resource_digest,
    limitations: [
      "In-process authenticated service calls",
      "Public demo provider, no production LTX or Runway integration claim",
      "No signed webhook delivery",
    ],
  };
  await writeFile(
    fixturePayments
      ? "evidence/generated-video-fixture-paypal.json"
      : "evidence/generated-video-sandbox.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} catch (error) {
  await writeFile(
    join(dir, "failure.json"),
    JSON.stringify({
      phase,
      diagnostic:
        error instanceof assert.AssertionError
          ? { actual: error.actual, expected: error.expected }
          : undefined,
    }),
    { mode: 0o600 },
  );
  console.error(
    JSON.stringify({ phase, passed: false, private_state_preserved: true }),
  );
  process.exitCode = 1;
} finally {
  await h.close();
}
