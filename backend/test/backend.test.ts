import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.js";
import {
  eligibleAmount,
  id,
  validateAssessment,
  type Batch,
  type Json,
} from "../src/domain/contracts.js";
import { publicAddress } from "../src/adapters/media.js";
import { token } from "../src/core/auth.js";
import { dispatchOutbox } from "../src/core/transport.js";
import { refundReferencesCapture } from "../src/adapters/paypal.js";
test("refund evidence must name the exact original capture at a trusted Sandbox host", () => {
  const links = (href: string) => ({
    links: [{ rel: "up", method: "GET", href }],
  });
  assert.equal(
    refundReferencesCapture(
      links("https://api.sandbox.paypal.com/v2/payments/captures/EXPECTED"),
      "EXPECTED",
    ),
    true,
  );
  for (const href of [
    "https://api.sandbox.paypal.com/v2/payments/captures/OTHER",
    "https://evil.example/v2/payments/captures/EXPECTED",
    "https://api.sandbox.paypal.com.evil.example/v2/payments/captures/EXPECTED",
    "https://api.sandbox.paypal.com/v2/payments/captures/EXPECTED?override=1",
  ])
    assert.equal(refundReferencesCapture(links(href), "EXPECTED"), false);
  assert.equal(refundReferencesCapture({}, "EXPECTED"), false);
});
test("integer unit pricing rejects duplicate/unknown logical units", () => {
  assert.equal(eligibleAmount([{ id: "a", price_minor: 500 }], ["a"]), 500);
  assert.throws(() =>
    eligibleAmount([{ id: "a", price_minor: 500 }], ["a", "a"]),
  );
  assert.throws(() => eligibleAmount([], ["missing"]));
});
test("SSRF public-address filter rejects loopback, metadata, private and mapped addresses", () => {
  for (const address of [
    "127.0.0.1",
    "169.254.169.254",
    "10.0.0.1",
    "192.168.0.1",
    "172.20.0.1",
    "100.64.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fe80::1",
    "fc00::1",
  ])
    assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress("8.8.8.8"), true);
});
test("eight delivered units produce one $40 capture and durable confirmed receipt", async () => {
  const h = await harness();
  try {
    const b = await h.setup();
    await h.seed(b, 8);
    const { permit, execute } = await h.settle(b);
    assert.equal(permit.amount_minor, 4000);
    const result = await execute();
    assert.equal(result.state, "CONFIRMED");
    await execute();
    assert.equal(h.paypal.captures, 1);
    await dispatchOutbox(h.contexts.payments, h.tenant); // queued execute is deduplicated
    await dispatchOutbox(h.contexts.payments, h.tenant); // completion event
    const updated = await h.request("/v1/batches/" + b.id);
    assert.equal(updated.json<Batch>().state, "CLOSED");
  } finally {
    await h.close();
  }
});
test("zero deliverable units void authorization without capture", async () => {
  const h = await harness();
  try {
    const b = await h.setup();
    const s = await h.settle(b);
    assert.equal(s.permit.amount_minor, 0);
    assert.equal((await s.execute()).state, "CONFIRMED");
    assert.equal(h.paypal.voids, 1);
    assert.equal(h.paypal.captures, 0);
  } finally {
    await h.close();
  }
});
test("missing AI prevents normal settlement while batch reads remain available", async () => {
  const h = await harness();
  try {
    const b = await h.setup();
    h.contexts.investigation.model = {
      available: false,
      assess: async () => {
        throw new Error();
      },
    };
    const r = await h.request("/v1/batches/" + b.id + "/investigate", {});
    assert.equal(r.statusCode, 503);
    assert.equal(
      (await h.request("/v1/batches/" + b.id + "/closure-preview", {}))
        .statusCode,
      409,
    );
    assert.equal((await h.request("/v1/batches/" + b.id)).statusCode, 200);
    assert.equal(h.paypal.captures, 0);
  } finally {
    await h.close();
  }
});
test("missing PayPal blocks authorization and provider spending", async () => {
  const h = await harness();
  try {
    h.paypal.available = false;
    const r = await h.request("/v1/batches", {
      buyer_id: h.buyer,
      unit_count: 1,
      unit_price_minor: 500,
      currency: "USD",
      prompt: "A blue bird in a forest",
    });
    const b = r.json<Batch>();
    await h.request(
      "/v1/batches/" + b.id + "/consent",
      { contract_hash: b.contract_hash },
      "buyer",
    );
    assert.equal(
      (await h.request("/v1/batches/" + b.id + "/paypal/order", {}, "buyer"))
        .statusCode,
      503,
    );
    assert.equal(
      (
        await h.request("/v1/batches/" + b.id + "/attempts", {
          unit_id: b.units[0]!.id,
        })
      ).statusCode,
      409,
    );
  } finally {
    await h.close();
  }
});
test("lost capture response stays unknown and never dispatches a second capture", async () => {
  const h = await harness();
  try {
    const b = await h.setup(1);
    await h.seed(b, 1);
    const s = await h.settle(b);
    h.paypal.loseCapture = true;
    assert.equal((await s.execute()).state, "UNKNOWN");
    await s.execute();
    assert.equal(h.paypal.captures, 1);
    assert.equal(
      (await h.request("/v1/batches/" + b.id)).json<Batch>().state,
      "CLAIMED",
    );
  } finally {
    await h.close();
  }
});
test("pending child capture never becomes confirmed cash", async () => {
  const h = await harness();
  try {
    const b = await h.setup(1);
    await h.seed(b, 1);
    h.paypal.pending = true;
    const s = await h.settle(b);
    assert.equal((await s.execute()).state, "PENDING");
    const account = await h.contexts.payments.db.tx(h.tenant, (q) =>
      q.query("SELECT captured FROM money_accounts"),
    );
    assert.equal(Number(account.rows[0]?.captured), 0);
  } finally {
    await h.close();
  }
});
test("wrong tenant, buyer, audience and direct external financial writes are rejected", async () => {
  const h = await harness();
  try {
    const b = await h.setup(1);
    assert.equal(
      (
        await h.request(
          "/v1/batches/" + b.id,
          undefined,
          "operator",
          "key-valid",
          id(),
        )
      ).statusCode,
      404,
    );
    const bad = await token(
      h.identities.operator,
      "commerce",
      h.tenant,
      "buyer",
      id(),
    );
    const r = await h.apps.commerce.inject({
      url: "/v1/batches/" + b.id,
      headers: { authorization: "Bearer " + bad },
    });
    assert.equal(r.statusCode, 404);
    const wrong = await h.apps.payments.inject({
      url: "/internal/batches/" + b.id + "/authorization",
      headers: { authorization: "Bearer " + bad },
    });
    assert.equal(wrong.statusCode, 401);
    const direct = await token(
      h.identities.operator,
      "payments",
      h.tenant,
      "operator",
    );
    assert.equal(
      (
        await h.apps.payments.inject({
          url: "/internal/orders",
          method: "POST",
          payload: { batch_id: b.id },
          headers: {
            authorization: "Bearer " + direct,
            "idempotency-key": "external-invalid",
          },
        })
      ).statusCode,
      403,
    );
  } finally {
    await h.close();
  }
});
test("idempotency rejects altered payload and returns original batch for a retry", async () => {
  const h = await harness();
  try {
    const body = {
      buyer_id: h.buyer,
      unit_count: 1,
      unit_price_minor: 500,
      currency: "USD",
      prompt: "A blue bird flying",
    };
    const first = await h.request(
      "/v1/batches",
      body,
      "operator",
      "same-batch-key",
    );
    const second = await h.request(
      "/v1/batches",
      body,
      "operator",
      "same-batch-key",
    );
    assert.equal(first.json<Json>().id, second.json<Json>().id);
    assert.equal(
      (
        await h.request(
          "/v1/batches",
          { ...body, unit_price_minor: 600 },
          "operator",
          "same-batch-key",
        )
      ).statusCode,
      409,
    );
  } finally {
    await h.close();
  }
});
test("original artifact recovery exercises buyer route before settlement", async () => {
  const h = await harness();
  try {
    const b = await h.setup(1);
    const artifacts = await h.seed(b, 1, false);
    const a = await h.request("/v1/batches/" + b.id + "/investigate", {});
    assert.equal(a.statusCode, 200);
    const assessment = a.json<Json>();
    const recovery = await h.request("/v1/batches/" + b.id + "/recover", {
      artifact_id: artifacts[0]!.id,
      assessment_id: assessment.id,
    });
    assert.equal(recovery.statusCode, 200, recovery.body);
    assert.equal(recovery.json<Json>().outcome, "VERIFIED");
    const s = await h.settle(b);
    assert.equal((await s.execute()).state, "CONFIRMED");
    assert.equal(h.paypal.captures, 1);
  } finally {
    await h.close();
  }
});
test("original capture refund is bounded and duplicate unit remedy rejected", async () => {
  const h = await harness();
  try {
    const b = await h.setup(2);
    await h.seed(b, 2);
    const s = await h.settle(b);
    await s.execute();
    const body = {
      unit_ids: [b.units[0]!.id],
      reason: "Merchant approved emergency delivery remedy",
      emergency: true,
    };
    const refund = await h.request("/v1/batches/" + b.id + "/refunds", body);
    assert.equal(refund.statusCode, 200, refund.body);
    const op = refund.json<Json>();
    assert.equal(op.amount_minor, 500);
    const duplicated = await h.request(
      "/v1/batches/" + b.id + "/refunds",
      body,
    );
    assert.equal(duplicated.statusCode, 409);
    await h.contexts.payments.call(
      "payments",
      "/internal/operations/" + op.id + "/execute",
      h.tenant,
      {},
      "execute-refund",
    );
    assert.equal(h.paypal.refunds, 1);
    assert.match(String(h.paypal.refundDetails?.note_to_payer), /^Refund of \$5\.00 against your Assay capture CAPTURE_FIXTURE\./);
    assert.equal(h.paypal.refundDetails?.invoice_id, op.id);
  } finally {
    await h.close();
  }
});
