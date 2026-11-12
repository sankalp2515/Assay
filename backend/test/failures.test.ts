import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.js";
import {
  id,
  type Batch,
  type Json,
  validateAssessment,
} from "../src/domain/contracts.js";
import { dispatchOutbox } from "../src/core/transport.js";
import { reconcile } from "../src/services/payments.js";

test("a delayed pending read cannot regress a confirmed capture or duplicate the journal", async () => {
  const h = await harness();
  let releaseRead!: () => void;
  const delayed = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  try {
    const batch = await h.setup(1);
    await h.seed(batch, 1);
    const settlement = await h.settle(batch);
    const ctx = h.contexts.payments;
    const key = String(settlement.permit.id);
    assert.equal((await reconcile(ctx, h.tenant, key)).state, "RESERVED");

    h.paypal.pending = true;
    assert.equal((await settlement.execute()).state, "PENDING");
    const getCapture = h.paypal.getCapture.bind(h.paypal);
    let started!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    h.paypal.getCapture = async () => {
      const pending = await getCapture();
      started();
      await delayed;
      return pending;
    };
    const stale = reconcile(ctx, h.tenant, key);
    await readStarted;
    h.paypal.getCapture = getCapture;
    h.paypal.pending = false;
    try {
      assert.equal((await reconcile(ctx, h.tenant, key)).state, "CONFIRMED");
    } finally {
      releaseRead();
      await stale;
    }
    assert.equal((await stale).state, "CONFIRMED");
    assert.equal(h.paypal.captures, 1);
    const journal = await ctx.db.tx(h.tenant, (q) =>
      q.query("SELECT amount_minor FROM financial_journal"),
    );
    assert.deepEqual(
      journal.rows.map((row) => Number(row.amount_minor)),
      [500],
    );
  } finally {
    releaseRead();
    await h.close();
  }
});
test("cancellation can safely release authorization while AI is unavailable", async () => {
  const h = await harness();
  try {
    const b = await h.setup();
    h.contexts.investigation.model!.available = false;
    const r = await h.request("/v1/batches/" + b.id + "/cancel", {}, "buyer");
    assert.equal(r.statusCode, 200);
    await dispatchOutbox(h.contexts.commerce, h.tenant);
    await dispatchOutbox(h.contexts.payments, h.tenant);
    assert.equal(h.paypal.voids, 1);
    assert.equal(h.paypal.captures, 0);
    assert.equal(
      (
        await h.request(
          "/v1/batches/" + b.id + "/paypal/authorize",
          {},
          "buyer",
        )
      ).statusCode,
      409,
    );
  } finally {
    await h.close();
  }
});
test("cancel wins before queued settlement claims its permit", async () => {
  const h = await harness();
  try {
    const b = await h.setup(1);
    await h.seed(b, 1);
    await h.request("/v1/batches/" + b.id + "/investigate", {});
    const preview = (
      await h.request("/v1/batches/" + b.id + "/closure-preview", {})
    ).json<Json>();
    await h.request("/v1/batches/" + b.id + "/approve", {
      proposal_id: preview.id,
      approval_digest: preview.approval_digest,
    });
    assert.equal(
      (await h.request("/v1/batches/" + b.id + "/cancel", {})).statusCode,
      200,
    );
    await assert.rejects(
      h.contexts.commerce.call(
        "payments",
        "/internal/settlements",
        h.tenant,
        { batch_id: b.id, permit_id: preview.id },
        "cancel-claim-test",
      ),
    );
    assert.equal(h.paypal.captures, 0);
  } finally {
    await h.close();
  }
});
test("claim wins cancellation and duplicate execution is serialized", async () => {
  const h = await harness();
  try {
    const b = await h.setup(1);
    await h.seed(b, 1);
    const s = await h.settle(b);
    assert.equal(
      (await h.request("/v1/batches/" + b.id + "/cancel", {})).statusCode,
      409,
    );
    await Promise.allSettled([s.execute(), s.execute()]);
    assert.equal(h.paypal.captures, 1);
  } finally {
    await h.close();
  }
});
test("modified evidence invalidates an existing AI assessment before closure", async () => {
  const h = await harness();
  try {
    const b = await h.setup(1);
    const artifacts = await h.seed(b, 1);
    await h.request("/v1/batches/" + b.id + "/investigate", {});
    await h.contexts.delivery.db.mutate(
      h.tenant,
      "artifact",
      String(artifacts[0]!.id),
      async (x) => ({ ...x, published: false }),
    );
    assert.equal(
      (await h.request("/v1/batches/" + b.id + "/closure-preview", {}))
        .statusCode,
      409,
    );
  } finally {
    await h.close();
  }
});
test("refund retry returns its original reservation and changed payload is rejected", async () => {
  const h = await harness();
  try {
    const b = await h.setup(2);
    await h.seed(b, 2);
    const s = await h.settle(b);
    await s.execute();
    const body = {
      unit_ids: [b.units[0]!.id],
      reason: "Approved emergency technical delivery remedy",
      emergency: true,
    };
    const key = "refund-replay-test";
    const first = await h.request(
      "/v1/batches/" + b.id + "/refunds",
      body,
      "operator",
      key,
    );
    const second = await h.request(
      "/v1/batches/" + b.id + "/refunds",
      body,
      "operator",
      key,
    );
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(first.json<Json>().id, second.json<Json>().id);
    assert.equal(
      (
        await h.request(
          "/v1/batches/" + b.id + "/refunds",
          { ...body, unit_ids: [b.units[1]!.id] },
          "operator",
          key,
        )
      ).statusCode,
      409,
    );
  } finally {
    await h.close();
  }
});
test("RLS rejects a write bearing another tenant and protects audit updates", async () => {
  const h = await harness();
  try {
    await assert.rejects(
      h.contexts.commerce.db.tx(h.tenant, (q) =>
        q.query(
          "INSERT INTO entities(tenant_id,kind,id,body) VALUES($1,$2,$3,$4)",
          [id(), "batch", id(), "{}"],
        ),
      ),
    );
    await assert.rejects(
      h.contexts.commerce.db.tx(h.tenant, (q) =>
        q.query("UPDATE audit SET action='tampered'"),
      ),
    );
  } finally {
    await h.close();
  }
});
test("unsupported citations and invented action units fail evidence validation", () => {
  const e = {
    id: id(),
    source: "provider" as const,
    unit_id: id(),
    text: "Task succeeded.",
  };
  const a = {
    disposition: "READY_TO_CLOSE" as const,
    explanation: "An unsupported claim must be rejected.",
    citations: [{ observation_id: e.id, quote: "Task failed." }],
    hypotheses: [{ description: "Failure", observation_ids: [e.id] }],
    actions: [
      {
        kind: "RESTORE_ACCESS" as const,
        unit_id: e.unit_id,
        reason: "Attempt recovery",
      },
    ],
  };
  assert.equal(validateAssessment(a, [e]), false);
  a.citations[0]!.quote = "Task succeeded.";
  a.actions[0]!.unit_id = id();
  assert.equal(validateAssessment(a, [e]), false);
});
test("dispatch pause blocks capture while reconciliation and safe reads stay available", async () => {
  const h = await harness();
  try {
    const b = await h.setup(1);
    await h.seed(b, 1);
    const s = await h.settle(b);
    assert.equal(
      (
        await h.request("/v1/controls/payments", {
          paused: true,
          reason: "Operator paused new captures for investigation",
        })
      ).statusCode,
      200,
    );
    await assert.rejects(s.execute());
    assert.equal(h.paypal.captures, 0);
    await h.request("/v1/controls/payments", {
      paused: false,
      reason: "Operator verified incident and resumed dispatch",
    });
    assert.equal((await s.execute()).state, "CONFIRMED");
    assert.equal(h.paypal.captures, 1);
  } finally {
    await h.close();
  }
});
test("unknown provider submission is never blindly repeated", async () => {
  const h = await harness();
  try {
    const b = await h.setup(1);
    let calls = 0;
    h.contexts.provider.allowPaid = true;
    h.contexts.provider.provider!.submit = async () => {
      calls++;
      throw new Error("Injected lost submit response");
    };
    const body = { unit_id: b.units[0]!.id };
    const r = await h.request(
      "/v1/batches/" + b.id + "/attempts",
      body,
      "operator",
      "provider-once",
    );
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json<Json>().state, "SUBMISSION_UNKNOWN");
    await h.request(
      "/v1/batches/" + b.id + "/attempts",
      body,
      "operator",
      "provider-once",
    );
    const next = await h.request("/v1/batches/" + b.id + "/attempts", body);
    assert.equal(next.statusCode, 409);
    assert.equal(calls, 1);
  } finally {
    await h.close();
  }
});
test("a failed AI assessment retries through the outbox and then settles normally", async () => {
  const h = await harness();
  try {
    const b = await h.setup(1);
    await h.seed(b, 1);
    const model = h.contexts.investigation.model!;
    const real = model.assess.bind(model);
    let calls = 0;
    model.assess = (async (...args: Parameters<typeof real>) => {
      calls++;
      if (calls === 1) throw new Error("model returned invalid JSON");
      return real(...args);
    }) as typeof model.assess;
    const first = await h.request("/v1/batches/" + b.id + "/investigate", {});
    assert.equal(first.statusCode, 200, first.body);
    // The first run failed and was put back in the queue, not parked as WAITING_FOR_AI.
    const queued = (await h.contexts.investigation.db.list<Json>(h.tenant, "assessment")).at(-1)!;
    assert.equal(queued.state, "RESERVED");
    assert.equal(queued.ai_attempts, 1);
    // Let the backoff elapse, then the outbox retries the same assessment.
    await h.contexts.investigation.db.tx(h.tenant, (q) => q.query("UPDATE outbox SET next_at=now() WHERE state='READY'"));
    await dispatchOutbox(h.contexts.investigation, h.tenant);
    const done = (await h.contexts.investigation.db.list<Json>(h.tenant, "assessment")).at(-1)!;
    assert.equal(done.id, queued.id);
    assert.equal(done.state, "VALID");
    assert.equal(calls, 2);
  } finally {
    await h.close();
  }
});
