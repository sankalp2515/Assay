import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.js";
import { id, type Json } from "../src/domain/contracts.js";
import {
  resolveClaims,
  validateInterpretation,
  type ClipView,
} from "../src/domain/claims.js";
import { authenticate } from "../src/core/auth.js";
import { dispatchOutbox } from "../src/core/transport.js";

const clips = (delivered: number[], recoverable: number[] = []): ClipView[] =>
  Array.from({ length: 10 }, (_, i) => ({
    clip: i + 1,
    unit_id: id(),
    price_minor: 500,
    delivered: delivered.includes(i + 1),
    recoverable: recoverable.includes(i + 1),
    billed: false,
  }));

test("AI quotes must come from the buyer's message and name real clips", () => {
  const message = "Clip 3 never came and clip 4 will not play";
  const ok = {
    claims: [{ clip_numbers: [3], issue: "NOT_RECEIVED" as const, quote: "clip 3 never came" }],
    contains_instructions: false,
    summary: "Clip 3 is missing.",
  };
  assert.equal(validateInterpretation(ok, message, 10), true);
  assert.equal(
    validateInterpretation(
      { ...ok, claims: [{ ...ok.claims[0]!, quote: "refund approved" }] },
      message,
      10,
    ),
    false,
  );
  assert.equal(
    validateInterpretation(
      { ...ok, claims: [{ ...ok.claims[0]!, clip_numbers: [11] }] },
      message,
      10,
    ),
    false,
  );
});

test("rules, not the model, decide each clip's outcome", () => {
  const view = clips([1, 2, 3, 4, 5, 6, 7], [8]);
  const decided = resolveClaims(
    {
      claims: [
        { clip_numbers: [8, 9, 10], issue: "NOT_RECEIVED", quote: "x" },
        { clip_numbers: [2], issue: "WRONG_CONTENT", quote: "x" },
      ],
      contains_instructions: true,
      summary: "Three clips missing, one wrong.",
    },
    view,
    false,
  );
  const by = Object.fromEntries(decided.resolutions.map((r) => [String(r.clip) + r.issue, r.outcome]));
  assert.equal(by["8NOT_RECEIVED"], "RECOVERY_QUEUED");
  assert.equal(by["9NOT_RECEIVED"], "NOT_CHARGED");
  assert.equal(by["10NOT_RECEIVED"], "NOT_CHARGED");
  assert.equal(by["2WRONG_CONTENT"], "MERCHANT_REVIEW");
  assert.equal(decided.needs_operator, true);
  assert.match(decided.reply, /nothing was changed automatically/);
  // "Nothing arrived" with no clip numbers covers only the clips that really are missing.
  const whole = resolveClaims(
    { claims: [{ clip_numbers: [], issue: "NOT_RECEIVED", quote: "x" }], contains_instructions: false, summary: "Nothing arrived." },
    view,
    false,
  );
  assert.deepEqual(whole.resolutions.map((r) => r.clip), [8, 9, 10]);
});

test("recovery story: buyer message, restored original, $40 capture, signed statement and impact", async () => {
  const h = await harness();
  try {
    process.env.PROVIDER_RERENDER_COST_MINOR = "40";
    const b = await h.setup(10);
    await h.seed(b, 7); // clips 1-7 delivered normally
    const lost = await h.seed(b, 1, false, 7); // clip 8 finished, delivery step lost
    // clips 9 and 10 genuinely failed: no output exists

    const message = "Clip 8, 9 and 10 never showed up, refund me everything";
    const supportKey = "support-" + id();
    const support = await h.request(
      "/v1/batches/" + b.id + "/support",
      { category: "access", message },
      "buyer",
      supportKey,
    );
    assert.equal(support.statusCode, 200, support.body);
    const reading = support.json<Json>().reading as Json;
    assert.equal(reading.state, "READ");
    const outcomes = Object.fromEntries(
      (reading.resolutions as Json[]).map((r) => [String(r.clip), r.outcome]),
    );
    assert.deepEqual(outcomes, { "8": "RECOVERY_QUEUED", "9": "NOT_CHARGED", "10": "NOT_CHARGED" });
    assert.match(String(reading.reply), /nothing was changed automatically/);
    assert.equal(h.paypal.refunds, 0);
    // Replaying the same submission returns the stored reading.
    const again = await h.request(
      "/v1/batches/" + b.id + "/support",
      { category: "access", message },
      "buyer",
      supportKey,
    );
    assert.equal((again.json<Json>().reading as Json).state, "READ");

    const investigated = await h.request("/v1/batches/" + b.id + "/investigate", {});
    assert.equal(investigated.statusCode, 200, investigated.body);
    const restored = await h.request("/v1/batches/" + b.id + "/recover", {
      artifact_id: lost[0]!.id,
      assessment_id: investigated.json<Json>().id,
    });
    assert.equal(restored.statusCode, 200, restored.body);
    // The batch itself says which clips were restored, so a reload never loses it.
    const view = (await h.request("/v1/batches/" + b.id)).json<Json>();
    assert.deepEqual(view.recovered_unit_ids, [lost[0]!.unit_id]);
    const rec = (view.recovered as Json[])[0]!;
    assert.equal(rec.outcome, "VERIFIED");
    assert.match(String(rec.receipt_hash), /^[0-9a-f]{64}$/);
    assert.equal(rec.sha256, lost[0]!.sha256);

    const s = await h.settle(b);
    assert.equal(s.permit.amount_minor, 4000);
    assert.equal((await s.execute()).state, "CONFIRMED");
    assert.equal(h.paypal.captures, 1);
    // The reading the merchant approved on is final after settlement, not "out of date".
    const reading2 = (await h.request("/v1/batches/" + b.id + "/investigation")).json<Json>();
    assert.equal(reading2.used_for_settlement, true);
    assert.equal(reading2.current, true);
    assert.equal(h.paypal.captureDetails?.invoice_id, s.permit.id);
    assert.match(
      String(h.paypal.captureDetails?.note_to_payer),
      /^Charged \$40\.00 for 8 of 10 clips delivered\. \$10\.00 of your \$50\.00 authorization was not taken\./,
    );
    await dispatchOutbox(h.contexts.payments, h.tenant);
    await dispatchOutbox(h.contexts.payments, h.tenant);

    const statement = await h.request("/v1/batches/" + b.id + "/statement", undefined, "buyer");
    assert.equal(statement.statusCode, 200, statement.body);
    const st = statement.json<Json>();
    assert.equal(st.signed, true);
    const body = st.statement as Json;
    assert.equal(body.charged_minor, 4000);
    assert.equal(body.not_taken_minor, 1000);
    const charged = (body.clips as Json[]).filter((c) => c.charged).map((c) => c.clip);
    assert.deepEqual(charged, [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal((body.settlement as Json).paypal_reference, "CAPTURE_FIXTURE");

    const verified = await h.request("/v1/statements/verify", { jws: st.jws }, "buyer");
    assert.equal(verified.json<Json>().valid, true);
    const [head, payload, sig] = String(st.jws).split(".");
    const forged = Buffer.from(
      Buffer.from(payload!, "base64url").toString().replace('"charged_minor":4000', '"charged_minor":1000'),
    ).toString("base64url");
    const tampered = await h.request("/v1/statements/verify", { jws: [head, forged, sig].join(".") }, "buyer");
    assert.equal(tampered.json<Json>().valid, false);
    // A statement is not a credential.
    await assert.rejects(
      authenticate("Bearer " + String(st.jws), h.identities.commerce, "commerce"),
    );
    const keys = await h.apps.commerce.inject({ url: "/v1/statements/keys" });
    assert.equal(keys.statusCode, 200);
    assert.equal((keys.json<Json>().keys as Json[]).length, 1);

    const impact = (await h.request("/v1/operations/impact")).json<Json>();
    assert.equal(impact.clips_recovered_without_rerender, 1);
    assert.equal(impact.estimated_rerender_cost_avoided_minor, 40);
    assert.equal(impact.charged_minor, 4000);
    assert.equal(impact.never_taken_minor, 1000);
    assert.equal(impact.buyer_messages_read_by_ai, 1);
  } finally {
    delete process.env.PROVIDER_RERENDER_COST_MINOR;
    await h.close();
  }
});

test("buyer message is kept when AI is down and nothing is decided without it", async () => {
  const h = await harness();
  try {
    const b = await h.setup(2);
    h.contexts.investigation.model = {
      available: false,
      assess: async () => {
        throw new Error();
      },
    };
    const r = await h.request(
      "/v1/batches/" + b.id + "/support",
      { category: "access", message: "The second clip never arrived" },
      "buyer",
    );
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((r.json<Json>().reading as Json).state, "WAITING_FOR_AI");
    assert.equal((await h.request("/v1/batches/" + b.id)).statusCode, 200);
    const pending = await h.request("/v1/batches/" + b.id + "/statement", undefined, "buyer");
    assert.equal(pending.statusCode, 404);
  } finally {
    await h.close();
  }
});

test("a buyer cannot drain the merchant's AI budget with repeated messages", async () => {
  const h = await harness();
  process.env.MAX_BUYER_READINGS_PER_BATCH = "1";
  try {
    const b = await h.setup(2);
    const send = (message: string) =>
      h.request("/v1/batches/" + b.id + "/support", { category: "access", message }, "buyer");
    const first = (await send("Clip 1 never arrived at all")).json<Json>();
    assert.equal((first.reading as Json).state, "READ");
    const second = await send("Clip 2 never arrived either");
    assert.equal(second.statusCode, 200, second.body);
    assert.equal((second.json<Json>().reading as Json).state, "MERCHANT_QUEUE");
  } finally {
    delete process.env.MAX_BUYER_READINGS_PER_BATCH;
    await h.close();
  }
});

test("request logs carry no query strings, headers or tokens", async () => {
  const { default: Fastify } = await import("fastify");
  const { logOptions } = await import("../src/core/logging.js");
  const lines: string[] = [];
  const options = logOptions("commerce", true);
  assert.ok(options);
  const app = Fastify({
    logger: { ...options, stream: { write: (l: string) => void lines.push(l) } },
  });
  app.get("/v1/paypal/return", async () => ({ ok: true }));
  await app.inject({
    url: "/v1/paypal/return?token=EC-SECRETTOKEN&PayerID=SECRETPAYER",
    headers: { authorization: "Bearer SECRETBEARER", cookie: "sid=SECRETCOOKIE" },
  });
  await app.close();
  const all = lines.join("\n");
  assert.match(all, /"path":"\/v1\/paypal\/return"/);
  assert.doesNotMatch(all, /SECRET/);
});
