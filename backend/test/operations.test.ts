import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.js";
import { id } from "../src/domain/contracts.js";

test("operator review restores unpublished state without exposing provider URLs to either role", async () => {
  const h = await harness();
  try {
    const batch = await h.setup(1);
    const [artifact] = await h.seed(batch, 1, false);
    const [attempt] = await h.contexts.provider.db.list(
      h.tenant,
      "attempt",
      batch.id,
    );
    await h.contexts.provider.db.mutate(
      h.tenant,
      "attempt",
      String(attempt!.id),
      async (old) => ({
        ...old,
        resource: {
          output: ["https://example.test/private-output?token=private"],
        },
      }),
    );
    const path = "/v1/batches/" + batch.id;
    const review = await h.request(path + "/review");
    assert.equal(review.statusCode, 200);
    assert.deepEqual(review.json().attempts, [
      {
        id: attempt!.id,
        unit_id: batch.units[0]!.id,
        state: "SUCCEEDED",
        provider_task_id: attempt!.provider_task_id,
      },
    ]);
    assert.equal(review.json().artifacts[0].id, artifact!.id);
    assert.equal(review.json().artifacts[0].published, false);
    assert.equal(review.body.includes("private-output"), false);
    assert.equal(
      (await h.request(path + "/review", undefined, "buyer")).statusCode,
      403,
    );
    assert.deepEqual(
      (await h.request(path + "/outcomes", undefined, "buyer")).json()
        .artifacts,
      [],
    );
  } finally {
    await h.close();
  }
});
test("webhook rejects forged event and atomically deduplicates reconciliation beyond first 100 operations", async () => {
  const h = await harness();
  const previousTenant = process.env.MERCHANT_TENANT_ID;
  process.env.MERCHANT_TENANT_ID = h.tenant;
  try {
    const event = {
      id: "EVENT_FIXTURE_01",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: "LATE_CAPTURE_FIXTURE" },
    };
    const forged = await h.apps.payments.inject({
      method: "POST",
      url: "/v1/paypal/webhooks",
      payload: event,
    });
    assert.equal(forged.statusCode, 401);
    await h.contexts.payments.db.tx(h.tenant, async (q) => {
      for (let i = 0; i < 105; i++)
        await h.contexts.payments.db.put(q, h.tenant, "operation", id(), {
          kind: "CAPTURE",
          provider_id: "OTHER_" + i,
        });
      await h.contexts.payments.db.put(q, h.tenant, "operation", id(), {
        kind: "CAPTURE",
        provider_id: "LATE_CAPTURE_FIXTURE",
      });
    });
    h.paypal.verifyWebhook = async () => true; // explicit signature fixture, never real PayPal proof
    for (let i = 0; i < 2; i++) {
      const response = await h.apps.payments.inject({
        method: "POST",
        url: "/v1/paypal/webhooks",
        payload: event,
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().matched, true);
    }
    const queued = await h.contexts.payments.db.tx(h.tenant, (q) =>
      q.query("SELECT * FROM outbox"),
    );
    assert.equal(queued.rows.length, 1);
    assert.equal(
      (await h.contexts.payments.db.list(h.tenant, "webhook")).length,
      1,
    );
  } finally {
    if (previousTenant === undefined) delete process.env.MERCHANT_TENANT_ID;
    else process.env.MERCHANT_TENANT_ID = previousTenant;
    await h.close();
  }
});
test("operator queue diagnostics enforce role and omit underlying customer evidence", async () => {
  const h = await harness();
  try {
    const response = await h.request("/v1/operations/health");
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().service, "commerce");
    assert.deepEqual(response.json().queues, []);
    assert.equal(
      (await h.request("/v1/operations/health", undefined, "buyer")).statusCode,
      403,
    );
  } finally {
    await h.close();
  }
});
test("public PayPal returns are informational and cannot mutate or reflect untrusted query data", async () => {
  const h = await harness();
  try {
    for (const path of ["return", "cancel"]) {
      const response = await h.apps.commerce.inject({
        url:
          "/v1/paypal/" + path + "?token=untrusted-query&PayerID=private-query",
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().payment_confirmed, false);
      assert.equal(response.body.includes("untrusted-query"), false);
    }
    assert.equal(
      (await h.contexts.payments.db.list(h.tenant, "operation")).length,
      0,
    );
  } finally {
    await h.close();
  }
});
test("operator-requested reassessment preserves history, budget admission and request identity", async () => {
  const h = await harness();
  try {
    const batch = await h.setup(1);
    await h.seed(batch, 1, false);
    const path = "/v1/batches/" + batch.id + "/investigate";
    const first = (await h.request(path, {})).json();
    assert.equal((await h.request(path, {})).json().id, first.id);
    const input = {
      refresh_reason:
        "Operator requests fresh diagnosis after reviewing the initial investigation.",
    };
    const key = "explicit-reassessment-v1";
    const refreshed = await h.request(path, input, "operator", key);
    assert.equal(refreshed.statusCode, 200);
    assert.notEqual(refreshed.json().id, first.id);
    assert.equal(
      (await h.request(path, input, "operator", key)).json().id,
      refreshed.json().id,
    );
    assert.equal(
      (
        await h.request(
          path,
          {
            refresh_reason:
              "Changed reason using an existing request identity.",
          },
          "operator",
          key,
        )
      ).statusCode,
      409,
    );
    assert.equal(
      (await h.contexts.investigation.db.list(h.tenant, "assessment")).length,
      2,
    );
  } finally {
    await h.close();
  }
});
