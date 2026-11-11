import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.js";
import type { Json } from "../src/domain/contracts.js";
import { Replicate, normalizeReplicate } from "../src/adapters/replicate.js";

test("Replicate predictions map onto the shared task states", () => {
  assert.deepEqual(
    normalizeReplicate({ id: "p1", status: "succeeded", output: "https://replicate.delivery/x/out.mp4" }),
    { id: "p1", status: "SUCCEEDED", output: ["https://replicate.delivery/x/out.mp4"], provider: "replicate" },
  );
  assert.equal(normalizeReplicate({ id: "p2", status: "processing", output: null }).status, "RUNNING");
  assert.equal(normalizeReplicate({ id: "p3", status: "canceled" }).status, "CANCELLED");
  assert.equal(normalizeReplicate({ id: "p4", status: "weird" }).status, "UNKNOWN");
});

test("merchant task intake: reported, Replicate and refused registrations", async () => {
  const h = await harness();
  const saved = process.env.REPORTED_OUTPUT_HOSTS;
  try {
    process.env.REPORTED_OUTPUT_HOSTS = "cdn.merchant.example";
    const b = await h.setup(4);
    const [u1, u2, u3, u4] = b.units;
    const task = (body: Json) => h.request("/v1/batches/" + b.id + "/tasks", body);

    // Any provider: the merchant reports the task and where the file is.
    const reported = await task({
      unit_id: u1!.id,
      source: "reported",
      provider_task_id: "fal-req-123",
      output_url: "https://cdn.merchant.example/renders/123.mp4",
    });
    assert.equal(reported.statusCode, 200, reported.body);
    assert.deepEqual(
      { state: reported.json<Json>().state, source: reported.json<Json>().source },
      { state: "SUCCEEDED", source: "reported" },
    );

    // An output host the merchant didn't approve in advance is refused.
    const offHost = await task({
      unit_id: u2!.id,
      source: "reported",
      provider_task_id: "fal-req-124",
      output_url: "https://169.254.169.254/latest/meta-data",
    });
    assert.equal(offHost.statusCode, 422, offHost.body);
    assert.equal(offHost.json<Json>().code, "unsafe_output_origin");

    // Looked-up sources never accept a caller-supplied URL.
    const smuggled = await task({
      unit_id: u2!.id,
      provider_task_id: "task-1",
      output_url: "https://cdn.merchant.example/x.mp4",
    });
    assert.equal(smuggled.json<Json>().code, "output_url_not_allowed");

    // Replicate is looked up with the merchant's own token.
    const calls: string[] = [];
    h.contexts.provider.providers = {
      replicate: new Replicate("r8_test", (async (url: string) => {
        calls.push(String(url));
        return new Response(
          JSON.stringify({ id: "pred-9", status: "succeeded", output: ["https://replicate.delivery/a/b.mp4"] }),
          { status: 200 },
        );
      }) as typeof fetch),
    };
    const rep = await task({ unit_id: u3!.id, source: "replicate", provider_task_id: "pred-9" });
    assert.equal(rep.statusCode, 200, rep.body);
    assert.equal(rep.json<Json>().state, "SUCCEEDED");
    assert.deepEqual(calls, ["https://api.replicate.com/v1/predictions/pred-9"]);

    // Replicate never generates on Assay's side.
    const gen = await task({ unit_id: u4!.id, source: "replicate" });
    assert.notEqual(gen.statusCode, 200);

    // The old /attempts name still works for existing integrations.
    assert.equal(
      (await h.request("/v1/batches/" + b.id + "/attempts", { unit_id: u2!.id, provider_task_id: "rw-1" })).statusCode,
      200,
    );
  } finally {
    if (saved === undefined) delete process.env.REPORTED_OUTPUT_HOSTS;
    else process.env.REPORTED_OUTPUT_HOSTS = saved;
    await h.close();
  }
});

test("merchant webhooks: signed clip.recovered and batch.settled through the outbox", async () => {
  const { createServer } = await import("node:http");
  const { dispatchOutbox } = await import("../src/core/transport.js");
  const { verifyWebhook } = await import("../src/core/webhooks.js");
  const received: { headers: Record<string, unknown>; raw: string }[] = [];
  let failNext = 1; // the first delivery gets a 500 and must be retried, not lost
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (failNext-- > 0) return res.writeHead(500).end();
      received.push({ headers: req.headers, raw });
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const secret = "whsec_" + "x".repeat(40);
  process.env.MERCHANT_WEBHOOK_URL = "http://127.0.0.1:" + port + "/assay";
  process.env.MERCHANT_WEBHOOK_SECRET = secret;
  const h = await harness();
  try {
    const b = await h.setup(10);
    await h.seed(b, 7);
    const lost = await h.seed(b, 1, false, 7);
    const investigated = await h.request("/v1/batches/" + b.id + "/investigate", {});
    const restored = await h.request("/v1/batches/" + b.id + "/recover", {
      artifact_id: lost[0]!.id,
      assessment_id: investigated.json<Json>().id,
    });
    assert.equal(restored.statusCode, 200, restored.body);
    const s = await h.settle(b);
    assert.equal((await s.execute()).state, "CONFIRMED");
    await dispatchOutbox(h.contexts.payments, h.tenant);
    await dispatchOutbox(h.contexts.payments, h.tenant);

    // Deliver only merchant events here; internal jobs were already driven by the harness.
    await h.contexts.commerce.db.tx(h.tenant, (q) =>
      q.query("UPDATE outbox SET state='DONE' WHERE target <> 'merchant'"),
    );
    for (let i = 0; i < 6; i++) {
      await h.contexts.commerce.db.tx(h.tenant, (q) =>
        q.query("UPDATE outbox SET next_at=now() WHERE state='READY'"),
      );
      if (!(await dispatchOutbox(h.contexts.commerce, h.tenant))) break;
    }
    const events = received.map((r) => JSON.parse(r.raw) as Json);
    assert.deepEqual(events.map((e) => e.type), ["clip.recovered", "batch.settled"]);
    for (const r of received)
      assert.equal(verifyWebhook(secret, String(r.headers["assay-signature"]), r.raw), true);
    assert.equal(verifyWebhook(secret, String(received[0]!.headers["assay-signature"]), r0tamper(received[0]!.raw)), false);
    const settled = events[1]!.data as Json;
    assert.deepEqual(
      { amount: settled.amount_minor, charged: settled.clips_charged, total: settled.clips_total, action: settled.action },
      { amount: 4000, charged: 8, total: 10, action: "CAPTURE" },
    );
    assert.equal(received[0]!.headers["assay-event-id"], events[0]!.id);
  } finally {
    delete process.env.MERCHANT_WEBHOOK_URL;
    delete process.env.MERCHANT_WEBHOOK_SECRET;
    server.close();
    await h.close();
  }
});
const r0tamper = (raw: string) => raw.replace("clip.recovered", "clip.recoverex");

test("registered tasks are archived automatically once they finish", async () => {
  const { dispatchOutbox } = await import("../src/core/transport.js");
  const saved = process.env.REPLICATE_ALLOWED_HOSTS;
  process.env.REPLICATE_ALLOWED_HOSTS = "cdn.merchant.example";
  const h = await harness();
  try {
    const b = await h.setup(2);
    let polls = 0;
    h.contexts.provider.providers = {
      replicate: new Replicate("r8_test", (async () => {
        polls++;
        const done = polls >= 3; // registration and first watch see it running
        return new Response(
          JSON.stringify({
            id: "pred-1",
            status: done ? "succeeded" : "processing",
            output: done ? "https://cdn.merchant.example/out.mp4" : null,
          }),
          { status: 200 },
        );
      }) as typeof fetch),
    };
    const reg = await h.request("/v1/batches/" + b.id + "/tasks", {
      unit_id: b.units[0]!.id,
      source: "replicate",
      provider_task_id: "pred-1",
    });
    assert.equal(reg.json<Json>().state, "RUNNING");
    const attempt = String(reg.json<Json>().id);
    const jobs = () =>
      h.contexts.commerce.db.tx(h.tenant, (q) =>
        q.query<{ state: string; attempts: number }>(
          "SELECT state, attempts FROM outbox WHERE path='/internal/tasks/archive'",
        ),
      );
    const artifacts = () => h.contexts.delivery.db.list<Json>(h.tenant, "artifact", b.id);

    await dispatchOutbox(h.contexts.commerce, h.tenant); // still running: retried later
    assert.deepEqual((await jobs()).rows.map((r) => [r.state, Number(r.attempts)]), [["READY", 1]]);
    assert.equal((await artifacts()).length, 0);

    await h.contexts.commerce.db.tx(h.tenant, (q) => q.query("UPDATE outbox SET next_at=now()"));
    await dispatchOutbox(h.contexts.commerce, h.tenant); // finished: archived without anyone asking
    assert.equal((await jobs()).rows[0]!.state, "DONE");
    const stored = await artifacts();
    assert.equal(stored.length, 1);
    assert.equal(stored[0]!.attempt_id, attempt);
    // The .example host can't be fetched in tests, so the copy is quarantined, not billed.
    assert.equal(stored[0]!.state, "QUARANTINED");
  } finally {
    if (saved === undefined) delete process.env.REPLICATE_ALLOWED_HOSTS;
    else process.env.REPLICATE_ALLOWED_HOSTS = saved;
    await h.close();
  }
});

test("PayPal return and cancel send the buyer back to the agreement page without confirming payment", async () => {
  const { buyerReturnBase, buyerReturnLocation, withBatch } = await import("../src/core/buyer-return.js");
  const batch = "16ef8eb7-07ec-4522-aed4-a81cee18a642";
  assert.equal(
    withBatch("http://localhost:4300/v1/paypal/return", batch),
    "http://localhost:4300/v1/paypal/return?batch=" + batch,
  );
  assert.throws(() => buyerReturnBase("http://evil.example"));
  assert.throws(() => buyerReturnBase("https://user:pw@shop.example"));
  assert.equal(buyerReturnBase("https://shop.example/app/"), "https://shop.example/app");
  assert.equal(buyerReturnLocation("../../evil", "http://localhost:5180"), undefined);
  assert.equal(buyerReturnLocation(["a"], "http://localhost:5180"), undefined);

  const h = await harness();
  const saved = process.env.BUYER_RETURN_BASE;
  try {
    delete process.env.BUYER_RETURN_BASE;
    const plain = await h.apps.commerce.inject({ url: "/v1/paypal/return?batch=" + batch });
    assert.equal(plain.statusCode, 200);
    assert.equal(plain.json<{ payment_confirmed: boolean }>().payment_confirmed, false);

    process.env.BUYER_RETURN_BASE = "http://localhost:5180";
    for (const path of ["/v1/paypal/return", "/v1/paypal/cancel"]) {
      const r = await h.apps.commerce.inject({
        url: path + "?batch=" + batch + "&token=EC-SECRET&PayerID=SECRETPAYER",
      });
      assert.equal(r.statusCode, 303);
      assert.equal(r.headers.location, "http://localhost:5180/#/buyer/" + batch + "/agreement");
      assert.doesNotMatch(String(r.headers.location), /SECRET/);
    }
    const bad = await h.apps.commerce.inject({ url: "/v1/paypal/return?batch=https://evil.example" });
    assert.equal(bad.statusCode, 200);
    assert.equal(bad.json<{ payment_confirmed: boolean }>().payment_confirmed, false);
  } finally {
    if (saved === undefined) delete process.env.BUYER_RETURN_BASE;
    else process.env.BUYER_RETURN_BASE = saved;
    await h.close();
  }
});
