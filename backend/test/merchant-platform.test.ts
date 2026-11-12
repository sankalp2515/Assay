import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.js";
import { id, type Json } from "../src/domain/contracts.js";
import { dispatchOutbox } from "../src/core/transport.js";
import { formatMoney, paypalValue } from "../src/domain/money.js";
import { authAssertion } from "../src/adapters/paypal.js";

const drain = async (ctx: Parameters<typeof dispatchOutbox>[0], tenant: string) => {
  for (let i = 0; i < 20 && (await dispatchOutbox(ctx, tenant)); i++);
};
const withEnv = async (vars: Record<string, string | undefined>, fn: () => Promise<void>) => {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
};

test("money: exact PayPal values and display per currency", () => {
  assert.equal(paypalValue(4000, "USD"), "40.00");
  assert.equal(paypalValue(4000, "EUR"), "40.00");
  assert.equal(paypalValue(4000, "JPY"), "4000");
  assert.equal(formatMoney(4000, "GBP"), "£40.00");
  assert.equal(formatMoney(4000, "JPY"), "¥4,000");
  assert.throws(() => paypalValue(1.5, "USD"));
  const [h, p, sig] = authAssertion("CLIENT", "MERCH12345").split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h!, "base64url").toString()), { alg: "none" });
  assert.deepEqual(JSON.parse(Buffer.from(p!, "base64url").toString()), { iss: "CLIENT", payer_id: "MERCH12345" });
  assert.equal(sig, "");
});

test("a EUR batch authorizes, captures and states its money in euros", async () => {
  const h = await harness();
  try {
    const b = await h.setup(10, "EUR");
    assert.equal(b.currency, "EUR");
    assert.equal(h.paypal.currency, "EUR");
    await h.seed(b, 8);
    const s = await h.settle(b);
    assert.equal(s.permit.currency, "EUR");
    assert.equal((await s.execute()).state, "CONFIRMED");
    assert.equal(h.paypal.captureAmount, 4000);
    assert.match(
      String(h.paypal.captureDetails?.note_to_payer),
      /^Charged €40\.00 for 8 of 10 clips delivered\. €10\.00 of your €50\.00 authorization was not taken\./,
    );
    await dispatchOutbox(h.contexts.payments, h.tenant);
    const st = (await h.request("/v1/batches/" + b.id + "/statement", undefined, "buyer")).json<Json>();
    assert.equal((st.statement as Json).currency, "EUR");
    // A currency PayPal partial capture doesn't cover here is refused at the contract.
    const bad = await h.request("/v1/batches", {
      buyer_id: h.buyer,
      unit_count: 1,
      unit_price_minor: 500,
      currency: "BTC",
      prompt: "Unsupported currency",
    });
    assert.equal(bad.statusCode, 400);
  } finally {
    await h.close();
  }
});

test("merchant sign-up, API keys, scopes, revocation and buyer sessions", async () => {
  const h = await harness();
  const commerce = h.apps.commerce;
  const call = (method: "GET" | "POST", url: string, auth?: string, payload?: Json) =>
    commerce.inject({
      method,
      url,
      headers: {
        ...(auth ? { authorization: "Bearer " + auth } : {}),
        ...(method === "POST" ? { "idempotency-key": "k-" + id() } : {}),
      },
      ...(payload ? { payload } : {}),
    });
  try {
    await withEnv({ SIGNUP_MODE: undefined }, async () => {
      const closed = await call("POST", "/v1/signup", undefined, { merchant_name: "Clipworks", email: "ops@clipworks.example" });
      assert.equal(closed.statusCode, 403);
    });
    await withEnv({ SIGNUP_MODE: "invite", SIGNUP_INVITE_CODE: "judges-2026-nov" }, async () => {
      const wrong = await call("POST", "/v1/signup", undefined, {
        merchant_name: "Clipworks",
        email: "ops@clipworks.example",
        invite_code: "guess",
      });
      assert.equal(wrong.statusCode, 403);
    });
    await withEnv({ SIGNUP_MODE: "open", PAYPAL_CLIENT_ID: "PUBLIC_CLIENT" }, async () => {
      const made = await call("POST", "/v1/signup", undefined, { merchant_name: "Clipworks", email: "Ops@Clipworks.example" });
      assert.equal(made.statusCode, 201, made.body);
      const acct = made.json<Json>();
      const key = String(acct.api_key);
      assert.match(key, /^assay_sk_[0-9a-f]{32}_/);
      const dup = await call("POST", "/v1/signup", undefined, { merchant_name: "Other", email: "ops@clipworks.example" });
      assert.equal(dup.statusCode, 409);

      const me = await call("GET", "/v1/account", key);
      assert.equal(me.statusCode, 200, me.body);
      assert.equal(me.json<Json>().tenant_id, acct.tenant_id);
      assert.equal(me.json<Json>().merchant_name, "Clipworks");

      // The new tenant cannot see the harness tenant's batches.
      const theirs = await h.setup(1);
      assert.equal((await call("GET", "/v1/batches/" + theirs.id, key)).statusCode, 404);

      // An integration key opens batches and registers work, but cannot approve money.
      const made2 = await call("POST", "/v1/api-keys", key, { name: "worker", scope: "integration" });
      assert.equal(made2.statusCode, 200, made2.body);
      const worker = String(made2.json<Json>().api_key);
      const buyer = id();
      const batch = await call("POST", "/v1/batches", worker, {
        buyer_id: buyer,
        unit_count: 2,
        unit_price_minor: 500,
        currency: "GBP",
        prompt: "Two short clips for an API key test",
      });
      assert.equal(batch.statusCode, 200, batch.body);
      const batchId = String(batch.json<Json>().id);
      const approve = await call("POST", "/v1/batches/" + batchId + "/approve", worker, {
        proposal_id: id(),
        approval_digest: "a".repeat(64),
      });
      assert.equal(approve.statusCode, 403);
      const listed = (await call("GET", "/v1/api-keys", key)).json<{ keys: Json[] }>().keys;
      assert.equal(listed.length, 2);
      // Listings show a short prefix only, never a usable secret.
      assert.ok(!JSON.stringify(listed).includes(key) && !JSON.stringify(listed).includes(worker));

      // Buyer session: one buyer, one batch.
      const session = await call("POST", "/v1/buyer-sessions", key, { batch_id: batchId, buyer_id: buyer });
      assert.equal(session.statusCode, 200, session.body);
      const bt = String(session.json<Json>().buyer_token);
      const view = await call("GET", "/v1/batches/" + batchId, bt);
      assert.equal(view.statusCode, 200, view.body);
      const consent = await call("POST", "/v1/batches/" + batchId + "/consent", bt, {
        contract_hash: view.json<Json>().contract_hash,
      });
      assert.equal(consent.statusCode, 200, consent.body);
      assert.equal((await call("GET", "/v1/batches", bt)).statusCode, 403);
      const wrongBuyer = await call("POST", "/v1/buyer-sessions", key, { batch_id: batchId, buyer_id: id() });
      assert.equal(wrongBuyer.statusCode, 404);

      // Keys never reach internal service routes.
      assert.equal((await call("GET", "/internal/batches/" + batchId, key)).statusCode, 401);

      // Revocation takes effect at once.
      const workerId = String(made2.json<Json>().id);
      assert.equal((await call("POST", "/v1/api-keys/" + workerId + "/revoke", key)).statusCode, 200);
      assert.equal((await call("GET", "/v1/batches/" + batchId, worker)).statusCode, 401);
      assert.equal((await call("GET", "/v1/account", key + "x")).statusCode, 401);

      const cfg = (await call("GET", "/v1/paypal/config")).json<Json>();
      assert.equal(cfg.client_id, "PUBLIC_CLIENT");
      assert.equal(cfg.intent, "authorize");
    });
  } finally {
    await h.close();
  }
});

test("PayPal dispute: read back, linked to the capture, refunds paused, evidence offered, merchant told", async () => {
  const h = await harness();
  await withEnv(
    {
      MERCHANT_TENANT_ID: h.tenant,
      MERCHANT_WEBHOOK_URL: "http://127.0.0.1:9/hook",
      MERCHANT_WEBHOOK_SECRET: "x".repeat(40),
    },
    async () => {
      try {
        const b = await h.setup(10);
        await h.seed(b, 8);
        const s = await h.settle(b);
        await s.execute();
        await drain(h.contexts.payments, h.tenant);

        const webhook = (event: Json) =>
          h.apps.payments.inject({ method: "POST", url: "/v1/paypal/webhooks", payload: event });
        // Unsigned events are refused.
        const forged = await webhook({ id: "WH-0", event_type: "CUSTOMER.DISPUTE.CREATED", resource: { dispute_id: "PP-D-1" } });
        assert.equal(forged.statusCode, 401);
        h.paypal.webhookValid = true;
        h.paypal.disputes["PP-D-1"] = {
          dispute_id: "PP-D-1",
          status: "WAITING_FOR_SELLER_RESPONSE",
          reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
          dispute_life_cycle_stage: "INQUIRY",
          disputed_transactions: [{ seller_transaction_id: "CAPTURE_FIXTURE" }],
          dispute_amount: { currency_code: "USD", value: "40.00" },
          seller_response_due_date: "2026-11-30T00:00:00Z",
        };
        // The event body claims a different status; only the read-back counts.
        const r = await webhook({
          id: "WH-1",
          event_type: "CUSTOMER.DISPUTE.CREATED",
          resource: { dispute_id: "PP-D-1", status: "RESOLVED" },
        });
        assert.equal(r.statusCode, 200, r.body);
        await drain(h.contexts.payments, h.tenant);

        const view = (await h.request("/v1/batches/" + b.id + "/disputes")).json<Json>();
        const d = (view.disputes as Json[])[0]!;
        assert.equal(d.status, "WAITING_FOR_SELLER_RESPONSE");
        assert.equal(d.batch_id, b.id);
        assert.equal(d.capture_id, "CAPTURE_FIXTURE");
        assert.equal(view.refunds_paused, true);
        assert.match(String((view.evidence as Json).jws), /^[\w-]+\.[\w-]+\.[\w-]+$/);

        const refund = await h.request("/v1/batches/" + b.id + "/refunds", {
          unit_ids: [b.units[0]!.id],
          reason: "Buyer asked for a refund during the dispute",
          emergency: true,
        });
        assert.equal(refund.statusCode, 409);
        assert.equal(refund.json<Json>().code, "dispute_open");
        assert.equal(h.paypal.refunds, 0);

        const hooks = await h.contexts.commerce.db.tx(h.tenant, (q) =>
          q.query<{ path: string }>("SELECT path FROM outbox WHERE target='merchant' ORDER BY created_at"),
        );
        const pay = await h.contexts.payments.db.tx(h.tenant, (q) =>
          q.query("SELECT path,state,attempts FROM outbox ORDER BY created_at"),
        );
        assert.ok(hooks.rows.some((x) => x.path === "/dispute.opened"), JSON.stringify([hooks.rows, pay.rows]));

        h.paypal.disputes["PP-D-1"] = { ...h.paypal.disputes["PP-D-1"]!, status: "RESOLVED" };
        await webhook({ id: "WH-2", event_type: "CUSTOMER.DISPUTE.RESOLVED", resource: { dispute_id: "PP-D-1" } });
        await drain(h.contexts.payments, h.tenant);
        const after = (await h.request("/v1/batches/" + b.id + "/disputes")).json<Json>();
        assert.equal(after.refunds_paused, false);
      } finally {
        await h.close();
      }
    },
  );
});

test("a merchant connects their own PayPal account; money then flows to it", async () => {
  const h = await harness();
  try {
    const off = await h.request("/v1/merchant/paypal/onboarding", { return_url: "https://shop.example/paypal" });
    assert.equal(off.statusCode, 409);
    await withEnv({ PAYPAL_PARTNER_MODE: "true" }, async () => {
      const started = await h.request("/v1/merchant/paypal/onboarding", { return_url: "https://shop.example/paypal" });
      assert.equal(started.statusCode, 200, started.body);
      assert.match(String(started.json<Json>().action_url), /^https:\/\/www\.sandbox\.paypal\.com\//);

      // The redirect is not trusted: PayPal must confirm the account for this tenant.
      const early = await h.request("/v1/merchant/paypal/complete", { merchant_id: "SELLERB12345" });
      assert.ok(early.statusCode >= 400);
      h.paypal.integrations.SELLERB12345 = {
        merchant_id: "SELLERB12345",
        tracking_id: id(), // another tenant's sign-up
        payments_receivable: true,
        primary_email_confirmed: true,
        oauth_integrations: [{ oauth_third_party: [{ partner_client_id: "CLIENT_FIXTURE" }] }],
      };
      const stolen = await h.request("/v1/merchant/paypal/complete", { merchant_id: "SELLERB12345" });
      assert.equal(stolen.json<Json>().code, "merchant_not_ready");
      h.paypal.integrations.SELLERB12345!.tracking_id = h.tenant;
      const done = await h.request("/v1/merchant/paypal/complete", { merchant_id: "SELLERB12345" });
      assert.equal(done.statusCode, 200, done.body);
      const status = (await h.request("/v1/merchant/paypal")).json<Json>();
      assert.equal(status.state, "ACTIVE");
      assert.equal(status.uses_platform_account, false);

      const b = await h.setup(10);
      assert.ok(h.paypal.actedFor.includes("SELLERB12345"));
      await h.seed(b, 8);
      const s = await h.settle(b);
      assert.equal((await s.execute()).state, "CONFIRMED");
      assert.equal(h.paypal.actedFor.at(-1), "SELLERB12345");
    });
  } finally {
    await h.close();
  }
});

test("sign-up registers the new tenant with every service's worker", async () => {
  const h = await harness();
  try {
    await withEnv({ SIGNUP_MODE: "open" }, async () => {
      const { knownTenants } = await import("../src/core/tenants.js");
      const made = await h.apps.commerce.inject({
        method: "POST",
        url: "/v1/signup",
        payload: { merchant_name: "Reelhouse", email: "team@reelhouse.example" },
      });
      assert.equal(made.statusCode, 201, made.body);
      const tenant = String(made.json<Json>().tenant_id);
      await new Promise((r) => setTimeout(r, 0));
      for (const name of ["commerce", "provider", "delivery", "investigation", "payments"] as const) {
        const rows = await h.contexts[name].db.list<Json>("00000000-0000-4000-a000-000000000000", "tenant_directory");
        assert.ok(rows.some((r) => r.id === tenant), name);
      }
      assert.ok((await knownTenants(h.contexts.payments, { TENANT_IDS: "" })).length >= 1);
    });
  } finally {
    await h.close();
  }
});

test("GCS store writes once, reads and deletes through the JSON API", async () => {
  const { GcsStore } = await import("../src/adapters/storage.js");
  const { writeFile, mkdtemp } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const objects = new Map<string, Buffer>();
  const seen: string[] = [];
  const fake: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    seen.push((init?.method ?? "GET") + " " + url.pathname + url.search);
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer T");
    if (url.pathname.startsWith("/upload/")) {
      const name = url.searchParams.get("name")!;
      if (objects.has(name)) return new Response("", { status: 412 });
      objects.set(name, Buffer.from(init!.body as Uint8Array));
      return new Response("{}", { status: 200 });
    }
    const name = decodeURIComponent(url.pathname.split("/o/")[1]!);
    if (init?.method === "DELETE") return objects.delete(name) ? new Response(null, { status: 204 }) : new Response("", { status: 404 });
    const b = objects.get(name);
    return b ? new Response(new Uint8Array(b)) : new Response("", { status: 404 });
  };
  const store = new GcsStore("assay-artifacts-test", "artifacts/", fake, async () => "T");
  const dir = await mkdtemp(join(tmpdir(), "gcs-test-"));
  const key = id();
  await writeFile(join(dir, "a.mp4"), "video-bytes");
  await store.put(key, join(dir, "a.mp4"));
  assert.ok(seen[0]!.includes("ifGenerationMatch=0"));
  assert.equal((await store.get(key)).toString(), "video-bytes");
  await writeFile(join(dir, "b.mp4"), "other");
  await store.put(key, join(dir, "b.mp4")); // existing original is kept, not replaced
  assert.equal((await store.get(key)).toString(), "video-bytes");
  await store.remove(key);
  await assert.rejects(store.get(key));
  assert.throws(() => new GcsStore("Bad Bucket!"));
  await assert.rejects(store.get("../../etc/passwd"));
});

test("Vertex AI is admitted only on explicit credit confirmation and calls the project endpoint", async () => {
  const { configuredInvestigator } = await import("../src/adapters/models.js");
  const { VertexGemini } = await import("../src/adapters/gemini.js");
  const off = configuredInvestigator({ AI_PRIMARY: "vertex", VERTEX_PROJECT: "assay-demo-123", AI_FALLBACK_PROVIDERS: "" });
  assert.equal(off.available, false);
  const on = configuredInvestigator({
    AI_PRIMARY: "vertex",
    VERTEX_PROJECT: "assay-demo-123",
    VERTEX_CREDITS_CONFIRMED: "true",
    AI_FALLBACK_PROVIDERS: "",
  });
  assert.equal(on.available, true);
  let called = "";
  const v = new VertexGemini("assay-demo-123", "global", "gemini-3.1-flash-lite", async () => "TOKEN", async (u, init) => {
    called = String(u) + " " + (init?.headers as Record<string, string>).authorization;
    return new Response(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: JSON.stringify({ claims: [], unrelated_text: [], instruction_like_text: [] }) }] } },
        ],
      }),
    );
  });
  await v.interpret("hello", 3).catch(() => undefined);
  assert.match(
    called,
    /^https:\/\/aiplatform\.googleapis\.com\/v1\/projects\/assay-demo-123\/locations\/global\/publishers\/google\/models\/gemini-3\.1-flash-lite:generateContent Bearer TOKEN$/,
  );
});

test("@assay/node SDK drives sign-up keys, intake and buyer sessions against Commerce", async () => {
  const { Assay, AssayError, verifyWebhook: sdkVerify } = await import("../sdk/src/index.js");
  const { sign } = await import("../src/core/webhooks.js");
  const h = await harness();
  try {
    await withEnv({ SIGNUP_MODE: "open" }, async () => {
      const made = await h.apps.commerce.inject({
        method: "POST",
        url: "/v1/signup",
        payload: { merchant_name: "SDK Studio", email: "sdk@studio.example" },
      });
      const key = String(made.json<Json>().api_key);
      // Route the SDK's fetch into the in-process Commerce app.
      const shim: typeof fetch = async (input, init) => {
        const u = new URL(String(input));
        const r = await h.apps.commerce.inject({
          method: (init?.method ?? "GET") as "GET" | "POST",
          url: u.pathname + u.search,
          headers: init?.headers as Record<string, string>,
          ...(init?.body ? { payload: String(init.body) } : {}),
        });
        return new Response(r.body, { status: r.statusCode, headers: { "content-type": "application/json" } });
      };
      const assay = new Assay({ apiKey: key, baseUrl: "http://localhost:4100", fetch: shim });
      assert.equal((await assay.account.get()).merchant_name, "SDK Studio");
      const buyer = id();
      const batch = await assay.batches.create(
        { buyer_id: buyer, unit_count: 3, unit_price_minor: 700, currency: "CAD", prompt: "Three clips from the SDK test" },
        "order-1001",
      );
      const again = await assay.batches.create(
        { buyer_id: buyer, unit_count: 3, unit_price_minor: 700, currency: "CAD", prompt: "Three clips from the SDK test" },
        "order-1001",
      );
      assert.equal(again.id, batch.id);
      await assert.rejects(
        assay.batches.registerTask(
          String(batch.id),
          { unit_id: String((batch.units as Json[])[0]!.id), source: "replicate", provider_task_id: "p1" },
          "unit-1-task-p1",
        ),
        (e: unknown) => e instanceof AssayError && e.status === 409,
      );
      const session = await assay.buyerSessions.create({ batch_id: String(batch.id), buyer_id: buyer }, "buyer-session-1");
      const asBuyer = new Assay({ apiKey: session.buyer_token, baseUrl: "http://localhost:4100", fetch: shim });
      assert.equal((await asBuyer.batches.get(String(batch.id))).currency, "CAD");
      assert.throws(() => new Assay({ apiKey: key, baseUrl: "http://example.com" }));
      const raw = JSON.stringify({ id: "e1", type: "batch.settled" });
      const t = Math.floor(Date.now() / 1000);
      assert.equal(sdkVerify("s".repeat(32), "t=" + t + ",v1=" + sign("s".repeat(32), t, raw), raw), true);
      assert.equal(sdkVerify("s".repeat(32), "t=" + t + ",v1=" + sign("s".repeat(32), t, raw), raw + " "), false);
    });
  } finally {
    await h.close();
  }
});

test("normal delivery publishes an archived clip with a buyer-route receipt, no AI involved", async () => {
  const h = await harness();
  try {
    const b = await h.setup(2);
    const [artifact] = await h.seed(b, 1, false);
    const r = await h.request("/v1/batches/" + b.id + "/deliver", { artifact_id: artifact!.id });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json<Json>().outcome, "VERIFIED");
    assert.equal(r.json<Json>().sha256, artifact!.sha256);
    const stranger = await h.request("/v1/batches/" + b.id + "/deliver", { artifact_id: id() });
    assert.equal(stranger.statusCode, 404);
  } finally {
    await h.close();
  }
});

test("demo provider gives each visitor a fresh case: 7 delivered, clip 8 lost, 9 and 10 never rendered", async () => {
  const h = await harness();
  try {
    const b = await h.setup(10);
    const path = "/v1/demo/batches/" + b.id + "/simulate-provider";
    assert.equal((await h.request(path, {})).statusCode, 404);
    await withEnv(
      { DEMO_SIMULATOR: "true", DEMO_CLIP_URL: "https://demo.assay.example/demo/test-clip.mp4", REPORTED_OUTPUT_HOSTS: "demo.assay.example" },
      async () => {
        const r = await h.request(path, {});
        assert.equal(r.statusCode, 200, r.body);
        const out = r.json<Json>();
        assert.equal(out.simulated, true);
        assert.deepEqual(out.delivered_clips, [1, 2, 3, 4, 5, 6, 7]);
        assert.equal(out.lost_clip, 8);
        assert.deepEqual(out.never_rendered_clips, [9, 10]);
        const jobs = await h.contexts.commerce.db.tx(h.tenant, (q) =>
          q.query<{ body: Json }>("SELECT body FROM outbox WHERE path='/internal/tasks/archive'"),
        );
        assert.equal(jobs.rows.length, 8);
        assert.equal(jobs.rows.filter((j) => j.body.deliver === true).length, 7);
        const view = (await h.request("/v1/batches/" + b.id)).json<Json>();
        assert.equal(view.state, "RUNNING");
        // Only once per batch.
        assert.equal((await h.request(path, {})).statusCode, 409);
      },
    );
  } finally {
    await h.close();
  }
});

test("gateway passes PayPal config, statement keys and same-origin sign-up through without a session", async () => {
  const { createGateway } = await import("../src/web/gateway.js");
  const { embedded } = await import("../src/core/database.js");
  const h = await harness();
  const db = await embedded();
  await db.migrate("commerce");
  const app = await createGateway({
    origin: "https://demo.example",
    tenant: h.tenant,
    identity: h.identities.operator,
    db,
    members: { op: { role: "operator", subject: h.operator } },
    commerceUrl: "https://commerce.internal",
    deliveryUrl: "https://delivery.internal",
    login: { authorization: () => "https://id.example", exchange: async () => "x" },
    network: async (url, init) => {
      const u = new URL(String(url));
      const r = await h.apps.commerce.inject({
        method: (init?.method ?? "GET") as "GET" | "POST",
        url: u.pathname,
        headers: init?.headers as Record<string, string>,
        ...(init?.body ? { payload: String(init.body) } : {}),
      });
      return new Response(r.body, { status: r.statusCode, headers: { "content-type": "application/json" } });
    },
  });
  try {
    await withEnv({ PAYPAL_CLIENT_ID: "PUBLIC_CLIENT_ID_FOR_TESTS", SIGNUP_MODE: undefined }, async () => {
      const cfg = await app.inject({ url: "/api/commerce/v1/paypal/config" });
      assert.equal(cfg.statusCode, 200);
      assert.equal(cfg.json<Json>().client_id, "PUBLIC_CLIENT_ID_FOR_TESTS");
      assert.equal((await app.inject({ url: "/api/commerce/v1/statements/keys" })).statusCode, 200);
      const cross = await app.inject({
        method: "POST",
        url: "/api/commerce/v1/signup",
        headers: { origin: "https://evil.example" },
        payload: { merchant_name: "X", email: "x@example.com" },
      });
      assert.equal(cross.statusCode, 403);
      const same = await app.inject({
        method: "POST",
        url: "/api/commerce/v1/signup",
        headers: { origin: "https://demo.example" },
        payload: { merchant_name: "X", email: "x@example.com" },
      });
      assert.equal(same.json<Json>().code, "signup_closed");
      assert.equal((await app.inject({ url: "/api/commerce/v1/batches" })).statusCode, 401);
    });
  } finally {
    await app.close();
    await db.close();
    await h.close();
  }
});

test("external playback probe runs after delivery, off the money path, and feeds dispute evidence", async () => {
  const h = await harness();
  const seen: Json[] = [];
  h.contexts.delivery.prober = {
    available: true,
    probe: async (input) => {
      seen.push({ ...input, bearer: input.bearer ? "present" : "absent" });
      return {
        outcome: "PLAYED",
        http_status: 200,
        bytes: 1000,
        sha256: input.expectedSha256 ?? null,
        current_time: 0.7,
        duration: 4,
        width: 1280,
        height: 720,
        replay_id: "rep_1",
        replay_view_url: "https://example.invalid/replay",
        browser: "kernel-chromium",
        error: null,
      };
    },
  };
  await withEnv({ PLAYBACK_PROBE_ORIGIN: "https://assay.example", KERNEL_MAX_PROBES_PER_DAY: "1" }, async () => {
    try {
      const b = await h.setup(3);
      const arts = await h.seed(b, 2, false);
      for (const art of arts)
        assert.equal((await h.request("/v1/batches/" + b.id + "/deliver", { artifact_id: art.id })).statusCode, 200);
      await drain(h.contexts.delivery, h.tenant);
      assert.equal(seen.length, 1); // daily budget of one
      assert.equal(seen[0]!.contentUrl, "https://assay.example/v1/artifacts/" + arts[0]!.id + "/content");
      assert.equal(seen[0]!.bearer, "present");
      const op = (await h.request("/v1/batches/" + b.id + "/playback")).json<Json>();
      assert.equal(op.enabled, true);
      const outcomes = (op.probes as Json[]).map((x) => x.outcome).sort();
      assert.deepEqual(outcomes, ["PLAYED", "SKIPPED_BUDGET"]);
      const played = (op.probes as Json[]).find((x) => x.outcome === "PLAYED")!;
      assert.equal(played.digest_matches, true);
      assert.equal(played.replay_view_url, "https://example.invalid/replay");
      const buyer = (await h.request("/v1/batches/" + b.id + "/playback", undefined, "buyer")).json<Json>();
      assert.ok((buyer.probes as Json[]).every((x) => !("replay_view_url" in x)));
      const evidence = (await h.request("/v1/batches/" + b.id + "/disputes")).json<Json>();
      assert.equal((evidence.playback_evidence as Json[]).length, 2);
    } finally {
      await h.close();
    }
  });
});

test("probe failures are recorded, never thrown into delivery", async () => {
  const h = await harness();
  h.contexts.delivery.prober = { available: true, probe: async () => { throw new Error("KERNEL down"); } };
  await withEnv({ PLAYBACK_PROBE_ORIGIN: "https://assay.example" }, async () => {
    try {
      const b = await h.setup(1);
      const [art] = await h.seed(b, 1, false);
      assert.equal((await h.request("/v1/batches/" + b.id + "/deliver", { artifact_id: art!.id })).statusCode, 200);
      await drain(h.contexts.delivery, h.tenant);
      const op = (await h.request("/v1/batches/" + b.id + "/playback")).json<Json>();
      assert.equal((op.probes as Json[])[0]!.outcome, "PROBE_ERROR");
      assert.equal((op.probes as Json[])[0]!.error, "KERNEL down");
    } finally {
      await h.close();
    }
  });
});

test("timeline and operations dashboard: observed facts and labeled estimates", async () => {
  const h = await harness();
  try {
    const b = await h.setup(10);
    await h.seed(b, 7);
    const lost = await h.seed(b, 1, false, 7);
    const tl = await h.request("/v1/batches/" + b.id + "/timeline");
    assert.equal(tl.statusCode, 200, tl.body);
    const t = tl.json<Json>();
    assert.equal((t.resources as Json[]).length, 11); // PayPal row + 10 clips
    const events = t.events as Json[];
    assert.ok(events.some((e) => e.kind === "authorization_honor" && e.basis === "ESTIMATE"));
    assert.ok(events.some((e) => e.kind === "authorization_validity" && e.basis === "OBSERVED"));
    assert.ok(events.some((e) => e.kind === "archive" && e.resourceId === lost[0]!.unit_id));
    assert.ok(!events.some((e) => e.kind === "retrievable" && e.resourceId === lost[0]!.unit_id));
    assert.ok(events.every((e) => ["OBSERVED", "ESTIMATE"].includes(String(e.basis))));
    const s = await h.settle(b);
    await s.execute();
    await drain(h.contexts.payments, h.tenant);
    const dash = (await h.request("/v1/operations/dashboard")).json<Json>();
    const row = (dash.rows as Json[]).find((r) => r.batch_id === b.id)!;
    assert.equal(row.currency, "USD");
    assert.equal(row.archived_not_delivered, 1);
    assert.equal(row.charged_minor, 3500);
    assert.equal(row.not_taken_minor, 1500);
    const clips = (await h.request("/v1/operations/dashboard?level=clip")).json<Json>().rows as Json[];
    assert.equal(clips.filter((c) => c.batch_id === b.id).length, 10);
    assert.equal(clips.find((c) => c.unit_id === lost[0]!.unit_id)!.delivered, false);
    assert.equal((await h.request("/v1/operations/dashboard", undefined, "buyer")).statusCode, 403);
  } finally {
    await h.close();
  }
});

test("PayPal webhooks find the tenant that created the PayPal resource", async () => {
  const h = await harness();
  await withEnv({ MERCHANT_TENANT_ID: id() }, async () => {
    try {
      const b = await h.setup(2);
      await h.seed(b, 2);
      const s = await h.settle(b);
      await s.execute();
      h.paypal.webhookValid = true;
      const r = await h.apps.payments.inject({
        method: "POST",
        url: "/v1/paypal/webhooks",
        payload: { id: "WH-CAP-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAPTURE_FIXTURE" } },
      });
      assert.equal(r.statusCode, 200, r.body);
      assert.equal(r.json<Json>().matched, true);
      const stored = await h.contexts.payments.db.list<Json>(h.tenant, "webhook");
      assert.ok(stored.some((w) => w.external_event_id === "WH-CAP-1"));
      // An id nobody created falls back to the configured tenant and matches nothing.
      const unknown = await h.apps.payments.inject({
        method: "POST",
        url: "/v1/paypal/webhooks",
        payload: { id: "WH-X-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "NOT_OURS_123" } },
      });
      assert.equal(unknown.json<Json>().matched, false);
    } finally {
      await h.close();
    }
  });
});

test("dashboard names an unreadable source instead of showing zero money", async () => {
  const h = await harness();
  try {
    const b = await h.setup(2);
    const original = h.contexts.commerce.call;
    h.contexts.commerce.call = async (target, path, t, body, key) => {
      if (target === "payments" && path.startsWith("/internal/batches/")) throw new Error("payments down");
      return original(target, path, t, body, key);
    };
    const row = ((await h.request("/v1/operations/dashboard")).json<Json>().rows as Json[]).find((r) => r.batch_id === b.id)!;
    assert.ok((row.unavailable as string[]).includes("operations"));
    assert.equal(row.charged_minor, null);
    assert.equal(row.authorized_minor, null);
    const tl = (await h.request("/v1/batches/" + b.id + "/timeline")).json<Json>();
    assert.ok((tl.unavailable as string[]).includes("authorization"));
    h.contexts.commerce.call = original;
    const impact = (await h.request("/v1/operations/impact")).json<Json>();
    assert.equal(impact.truncated, false);
  } finally {
    await h.close();
  }
});
