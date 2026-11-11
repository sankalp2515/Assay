import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.js";
import { id, type Json } from "../src/domain/contracts.js";
import { dispatchOutbox } from "../src/core/transport.js";
import { maintain } from "../src/core/maintenance.js";

test("product read models and support enforce buyer ownership, privacy and retention", async () => {
  const h = await harness();
  try {
    const b = await h.setup(1),
      root = "/v1/batches/" + b.id;
    await h.seed(b, 1);
    const readiness = await h.request("/v1/readiness");
    assert.equal(readiness.statusCode, 200, readiness.body);
    assert.equal(readiness.json().environment, "fixture");
    assert.equal(readiness.json().services.length, 4);
    assert.equal(
      (await h.request("/v1/readiness", undefined, "buyer")).statusCode,
      403,
    );
    assert.equal(
      (await h.request("/v1/operations/overview")).json().services.length,
      5,
    );
    const financial = await h.request(root + "/financials", undefined, "buyer");
    assert.equal(financial.statusCode, 200);
    assert.equal(financial.json().authorization.state, "AUTHORIZED");
    assert.ok(!financial.body.includes("request_key"));
    assert.equal(
      (
        await h.request(
          root + "/financials",
          undefined,
          "buyer",
          undefined,
          id(),
        )
      ).statusCode,
      404,
    );
    const created = await h.request(
      root + "/support",
      { category: "access", message: "The downloaded video cannot be opened" },
      "buyer",
      "support-original-key",
    );
    assert.equal(created.statusCode, 200, created.body);
    assert.equal(
      (
        await h.request(
          root + "/support",
          {
            category: "access",
            message: "The downloaded video cannot be opened",
          },
          "buyer",
          "support-original-key",
        )
      ).json().id,
      created.json().id,
    );
    assert.equal(
      (
        await h.request(
          root + "/support",
          {
            category: "access",
            message: "Secret at https://example.test/private",
          },
          "buyer",
        )
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await h.request(
          root + `/support/${created.json().id}/resolve`,
          { resolution: "Restored access to the original file" },
          "buyer",
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await h.request(root + `/support/${created.json().id}/resolve`, {
          resolution: "Restored access to the original file",
        })
      ).statusCode,
      200,
    );
    const activity = await h.request(root + "/activity", undefined, "buyer");
    assert.ok(
      activity.json().events.some((e: Json) => e.action === "AUTHORIZED"),
    );
    await h.contexts.commerce.db.mutate(
      h.tenant,
      "support_case",
      created.json().id,
      async (c) => ({ ...c, retention_until: "2000-01-01T00:00:00Z" }),
    );
    await maintain(h.contexts.commerce, h.tenant);
    const retained = (
      await h.request(root + "/support", undefined, "buyer")
    ).json().items[0];
    assert.equal(retained.state, "EXPIRED");
    assert.equal(retained.resolution, null);
    assert.ok(!retained.message.includes("downloaded"));
    const call = h.contexts.commerce.call;
    h.contexts.commerce.call = async (target, ...args) => {
      if (target === "payments") throw Error("Injected payments outage");
      return call(target, ...args);
    };
    const duringOutage = await h.request(
      root + "/outcomes",
      undefined,
      "buyer",
    );
    assert.equal(duringOutage.statusCode, 200, duringOutage.body);
    assert.equal(duringOutage.json().artifacts.length, 1);
    assert.equal(duringOutage.json().payment_status_unavailable, true);
  } finally {
    await h.close();
  }
});

test("normal refund uses exact expiring review, rejects stale money and safely replays approval", async () => {
  const h = await harness();
  try {
    const b = await h.setup(3);
    await h.seed(b, 2);
    const s = await h.settle(b);
    await s.execute();
    for (let i = 0; i < 3; i++) {
      await dispatchOutbox(h.contexts.payments, h.tenant);
      await dispatchOutbox(h.contexts.commerce, h.tenant);
    }
    const root = "/v1/batches/" + b.id;
    const available = (await h.request(root + "/financials")).json();
    assert.equal(available.refundable_units.length, 2);
    assert.ok(
      !available.refundable_units.some(
        (u: Json) => u.unit_id === b.units[2]!.id,
      ),
    );
    const assessment = await h.request(root + "/investigate", {});
    assert.equal(assessment.statusCode, 200, assessment.body);
    const body = {
      unit_ids: [b.units[0]!.id],
      reason: "Buyer could not use this delivered original clip",
      assessment_id: assessment.json().id,
    };
    assert.equal((await h.request(root + "/refunds", body)).statusCode, 409);
    const reviewed = await h.request(root + "/refund-preview", body);
    assert.equal(reviewed.statusCode, 200, reviewed.body);
    const p = reviewed.json();
    assert.equal(p.amount_minor, 500);
    assert.equal(p.capture_id, "CAPTURE_FIXTURE");
    const approved = {
      ...body,
      proposal_id: p.id,
      approval_digest: p.approval_digest,
    };
    assert.equal(
      (
        await h.request(root + "/refunds", {
          ...approved,
          reason: "A different reason that was not reviewed",
        })
      ).statusCode,
      409,
    );
    const result = await h.request(
      root + "/refunds",
      approved,
      "operator",
      "review-refund-stable-key",
    );
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().amount_minor, 500);
    const replay = await h.request(
      root + "/refunds",
      approved,
      "operator",
      "review-refund-stable-key",
    );
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().id, result.json().id);
    assert.equal(
      (
        await h.request(
          root + "/refunds",
          approved,
          "operator",
          "a-new-key-cannot-reuse-review",
        )
      ).statusCode,
      409,
    );
    await h.contexts.payments.call(
      "payments",
      "/internal/operations/" + result.json().id + "/execute",
      h.tenant,
      {},
      "execute-reviewed-refund",
    );
    assert.equal(h.paypal.refunds, 1);
    const nextAssessment = await h.request(root + "/investigate", {});
    const nextBody = {
      ...body,
      unit_ids: [b.units[1]!.id],
      assessment_id: nextAssessment.json().id,
    };
    const nextPreview = (
      await h.request(root + "/refund-preview", nextBody)
    ).json();
    assert.ok(nextPreview.id);
    h.contexts.payments.now = () => Date.now() + 60000;
    assert.equal(
      (
        await h.request(root + "/refunds", {
          ...nextBody,
          proposal_id: nextPreview.id,
          approval_digest: nextPreview.approval_digest,
        })
      ).statusCode,
      409,
    );
    assert.equal(h.paypal.refunds, 1);
    const finance = (await h.request(root + "/financials")).json();
    assert.equal(finance.refundable_units.length, 1);
    assert.equal(finance.refundable_units[0].unit_id, b.units[1]!.id);
    assert.equal(
      finance.operations.filter((o: Json) => o.kind === "REFUND").length,
      1,
    );
  } finally {
    await h.close();
  }
});
