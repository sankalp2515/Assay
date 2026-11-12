import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.js";
import { embedded } from "../src/core/database.js";
import { createGateway, safeReturn } from "../src/web/gateway.js";
import { token } from "../src/core/auth.js";
test("safe return paths reject external destinations and injected query strings", () => {
  for (const value of [
    "https://evil.example",
    "//evil.example",
    "/#/batches?redirect=evil",
    "/#/<script>",
    "/%2fevil",
  ])
    assert.equal(safeReturn(value), "/#/batches");
  assert.equal(
    safeReturn("/#/buyer/00000000-0000-4000-a000-000000000001/agreement"),
    "/#/buyer/00000000-0000-4000-a000-000000000001/agreement",
  );
});
test("gateway binds sessions to verified membership, rejects CSRF and role forgery, revokes logout and prevents callback replay", async () => {
  const h = await harness(),
    db = await embedded();
  await db.migrate("commerce");
  let app: Awaited<ReturnType<typeof createGateway>> | undefined;
  try {
    const b = await h.setup(1);
    app = await createGateway({
      origin: "https://delivery.example",
      tenant: h.tenant,
      identity: h.identities.operator,
      db,
      members: {
        buyer: { role: "buyer", subject: h.buyer },
        operator: { role: "operator", subject: h.operator },
      },
      commerceUrl: "https://commerce.internal",
      deliveryUrl: "https://delivery.internal",
      login: {
        authorization(state, nonce, verifier) {
          assert.equal(nonce.length, 43);
          assert.equal(verifier.length, 43);
          return "https://id.example/authorize?state=" + state;
        },
        async exchange(code, nonce, verifier) {
          assert.equal(nonce.length, 43);
          assert.equal(verifier.length, 43);
          return code;
        },
      },
      network: async (url, init) => {
        const u = new URL(String(url));
        const r = await h.apps.commerce.inject({
          method: init!.method as "GET" | "POST",
          url: u.pathname + u.search,
          headers: init!.headers as Record<string, string>,
          ...(init!.body ? { payload: String(init!.body) } : {}),
        });
        return new Response(r.body, {
          status: r.statusCode,
          headers: { "Content-Type": r.headers["content-type"] as string },
        });
      },
    });
    assert.equal((await app.inject({ url: "/api/session" })).statusCode, 401);
    const start = await app.inject({
      url: "/api/login?returnTo=%2F%23%2Fbuyer%2F" + b.id,
    });
    const state = new URL(start.headers.location!).searchParams.get("state");
    const stateCookie = String(start.headers["set-cookie"]).split(";")[0]!;
    assert.equal(
      (
        await app.inject({
          url: `/api/callback?state=wrong&code=buyer`,
          headers: { cookie: stateCookie },
        })
      ).statusCode,
      400,
    );
    const callback = await app.inject({
      url: `/api/callback?state=${state}&code=buyer`,
      headers: { cookie: stateCookie },
    });
    assert.equal(callback.statusCode, 302, callback.body);
    const setCookies = callback.headers["set-cookie"] as string[];
    const cookie = setCookies
      .find((c) => c.startsWith("__Host-pvd-session="))!
      .split(";")[0]!;
    assert.ok(setCookies[0]!.includes("HttpOnly"));
    assert.ok(setCookies[0]!.includes("Secure"));
    assert.equal(
      (
        await app.inject({
          url: `/api/callback?state=${state}&code=buyer`,
          headers: { cookie: stateCookie },
        })
      ).statusCode,
      400,
    );
    const session = (
      await app.inject({ url: "/api/session", headers: { cookie } })
    ).json();
    assert.equal(session.role, "buyer");
    assert.ok(!JSON.stringify(session).includes("Bearer"));
    assert.equal(
      (
        await app.inject({
          url: `/api/commerce/v1/batches/${b.id}`,
          headers: { cookie },
        })
      ).statusCode,
      200,
    );
    const operatorToken = await token(
      h.identities.operator,
      "commerce",
      h.tenant,
      "operator",
      h.operator,
    );
    assert.equal(
      (
        await app.inject({
          url: `/api/commerce/v1/batches/${b.id}/review`,
          headers: { cookie, authorization: "Bearer " + operatorToken },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/commerce/internal/batches/" + b.id,
          headers: { cookie },
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/logout",
          method: "POST",
          headers: {
            cookie,
            origin: "https://evil.example",
            "x-csrf-token": session.csrf,
          },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/logout",
          method: "POST",
          headers: {
            cookie,
            origin: "https://delivery.example",
            "x-csrf-token": session.csrf,
          },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ url: "/api/session", headers: { cookie } }))
        .statusCode,
      401,
    );
  } finally {
    await app?.close();
    await db.close();
    await h.close();
  }
});
test("demo login is off by default and refuses when no workspace can be created", async () => {
  const h = await harness(),
    db = await embedded();
  await db.migrate("commerce");
  const make = (demoLogin: boolean) =>
    createGateway({
      origin: "https://demo.example",
      tenant: h.tenant,
      identity: h.identities.operator,
      db,
      demoLogin,
      members: {
        "demo-buyer": { role: "buyer", subject: h.buyer },
        "demo-operator": { role: "operator", subject: h.operator },
      },
      commerceUrl: "https://commerce.internal",
      deliveryUrl: "https://delivery.internal",
      login: { authorization: () => "https://id.example", exchange: async () => "x" },
    });
  const off = await make(false);
  const on = await make(true);
  try {
    assert.equal((await off.inject({ url: "/api/demo-login?as=operator" })).statusCode, 404);
    const csp = String((await on.inject({ url: "/api/session" })).headers["content-security-policy"]);
    assert.match(csp, /script-src 'self' https:\/\/www\.paypal\.com https:\/\/www\.sandbox\.paypal\.com/);
    assert.match(csp, /frame-src https:\/\/www\.paypal\.com/);
    // Without a reachable Commerce the workspace cannot be created: refused, no session.
    const r = await on.inject({ url: "/api/demo-login?as=buyer&returnTo=https://evil.example" });
    assert.equal(r.statusCode, 503);
    assert.equal(r.headers["set-cookie"], undefined);
  } finally {
    await off.close();
    await on.close();
    await db.close();
    await h.close();
  }
});
test("CSP allows exactly the inline scripts shipped in index.html, by hash", async () => {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { createHash } = await import("node:crypto");
  const dir = await mkdtemp(join(tmpdir(), "assets-"));
  const inline = "document.documentElement.dataset.x='1'";
  await writeFile(join(dir, "index.html"), `<html><head><script>${inline}</script><script type="module" src="/a.js"></script></head></html>`);
  const h = await harness(),
    db = await embedded();
  await db.migrate("commerce");
  const app = await createGateway({
    origin: "https://demo.example",
    tenant: h.tenant,
    identity: h.identities.operator,
    db,
    members: { op: { role: "operator", subject: h.operator } },
    commerceUrl: "https://commerce.internal",
    deliveryUrl: "https://delivery.internal",
    assetsDir: dir,
    login: { authorization: () => "https://id.example", exchange: async () => "x" },
  });
  try {
    const r = await app.inject({ url: "/" });
    assert.equal(r.statusCode, 200);
    const csp = String(r.headers["content-security-policy"]);
    assert.ok(csp.includes("'sha256-" + createHash("sha256").update(inline).digest("base64") + "'"), csp);
    assert.ok(!csp.includes("unsafe-inline'") || /style-src[^;]*unsafe-inline/.test(csp));
    assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
  } finally {
    await app.close();
    await db.close();
    await h.close();
  }
});
test("two demo visitors get isolated workspaces and cannot reach controls or keys", async () => {
  const h = await harness(),
    db = await embedded();
  await db.migrate("commerce");
  process.env.DEMO_WORKSPACES = "true";
  const app = await createGateway({
    origin: "https://demo.example",
    tenant: h.tenant,
    identity: h.identities.operator,
    db,
    demoLogin: true,
    members: { op: { role: "operator", subject: h.operator } },
    commerceUrl: "https://commerce.internal",
    deliveryUrl: "https://delivery.internal",
    login: { authorization: () => "https://id.example", exchange: async () => "x" },
    network: async (url, init) => {
      const u = new URL(String(url));
      const r = await h.apps.commerce.inject({
        method: init!.method as "GET" | "POST",
        url: u.pathname + u.search,
        headers: init!.headers as Record<string, string>,
        ...(init!.body ? { payload: String(init!.body) } : {}),
      });
      return new Response(r.body, { status: r.statusCode, headers: { "Content-Type": "application/json" } });
    },
  });
  const login = async (as: string, wsCookie?: string) => {
    const r = await app.inject({ url: "/api/demo-login?as=" + as, headers: wsCookie ? { cookie: wsCookie } : {} });
    assert.equal(r.statusCode, 302, r.body);
    const set = ([] as string[]).concat(r.headers["set-cookie"] as string[]);
    const session = set.find((c) => c.includes("pvd-session"))!.split(";")[0]!;
    const ws = set.find((c) => c.includes("pvd-demo-ws"))?.split(";")[0];
    return { session, ws };
  };
  try {
    const a = await login("operator");
    const b = await login("operator");
    assert.ok(a.ws && b.ws && a.ws !== b.ws);
    const sa = (await app.inject({ url: "/api/session", headers: { cookie: a.session } })).json<{ csrf: string; demo: boolean }>();
    assert.equal(sa.demo, true);
    const create = await app.inject({
      method: "POST",
      url: "/api/commerce/v1/batches",
      headers: { cookie: a.session, origin: "https://demo.example", "x-csrf-token": sa.csrf, "idempotency-key": "demo-a-batch-1" },
      payload: {
        buyer_id: (await app.inject({ url: "/api/directory", headers: { cookie: a.session } })).json<{ buyers: { id: string }[] }>().buyers[0]!.id,
        unit_count: 2,
        unit_price_minor: 500,
        currency: "USD",
        prompt: "Visitor A's own demo batch",
      },
    });
    assert.equal(create.statusCode, 200, create.body);
    const batchId = create.json<{ id: string }>().id;
    // Visitor B sees nothing of A's.
    const bList = await app.inject({ url: "/api/commerce/v1/batches/" + batchId, headers: { cookie: b.session } });
    assert.equal(bList.statusCode, 404);
    // Switching A to the buyer keeps A's workspace; that buyer can read A's batch.
    const aBuyer = await login("buyer", a.ws);
    assert.equal(aBuyer.ws, undefined);
    assert.equal((await app.inject({ url: "/api/commerce/v1/batches/" + batchId, headers: { cookie: aBuyer.session } })).statusCode, 200);
    // Demo sessions cannot reach payment controls or keys.
    const sb = (await app.inject({ url: "/api/session", headers: { cookie: b.session } })).json<{ csrf: string }>();
    for (const path of ["/api/commerce/v1/controls/payments", "/api/commerce/v1/api-keys"]) {
      const r = await app.inject({
        method: "POST",
        url: path,
        headers: { cookie: b.session, origin: "https://demo.example", "x-csrf-token": sb.csrf, "idempotency-key": "demo-b-ctl-1" },
        payload: {},
      });
      assert.equal(r.statusCode, 403, path);
    }
    // The configured merchant tenant is untouched by demo visitors.
    assert.equal((await h.request("/v1/batches")).json<{ items: unknown[] }>().items.length, 0);
  } finally {
    delete process.env.DEMO_WORKSPACES;
    await app.close();
    await db.close();
    await h.close();
  }
});
test("a merchant signs up, signs in with the operator key and works in a persistent workspace of their own", async () => {
  const h = await harness(),
    db = await embedded();
  await db.migrate("commerce");
  process.env.SIGNUP_MODE = "open";
  const app = await createGateway({
    origin: "https://demo.example",
    tenant: h.tenant,
    identity: h.identities.operator,
    db,
    demoLogin: true,
    members: {},
    commerceUrl: "https://commerce.internal",
    deliveryUrl: "https://delivery.internal",
    login: { authorization: () => "https://id.example", exchange: async () => "x" },
    network: async (url, init) => {
      const u = new URL(String(url));
      const r = await h.apps.commerce.inject({
        method: ((init?.method as "GET" | "POST") || "GET"),
        url: u.pathname + u.search,
        headers: (init?.headers as Record<string, string>) || {},
        ...(init?.body ? { payload: String(init.body) } : {}),
      });
      return new Response(r.body, { status: r.statusCode, headers: { "Content-Type": "application/json" } });
    },
  });
  try {
    const signup = await app.inject({
      method: "POST",
      url: "/api/commerce/v1/signup",
      headers: { origin: "https://demo.example" },
      payload: { merchant_name: "Reelhouse Studio", email: "ops@reelhouse.example" },
    });
    assert.equal(signup.statusCode, 201, signup.body);
    const { api_key, tenant_id } = signup.json<{ api_key: string; tenant_id: string }>();
    // Wrong origin, malformed and unknown keys are refused.
    assert.equal((await app.inject({ method: "POST", url: "/api/account-login", headers: { origin: "https://evil.example" }, payload: { api_key } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/api/account-login", headers: { origin: "https://demo.example" }, payload: { api_key: "nope" } })).statusCode, 400);
    assert.equal((await app.inject({ method: "POST", url: "/api/account-login", headers: { origin: "https://demo.example" }, payload: { api_key: api_key.slice(0, -4) + "AAAA" } })).statusCode, 401);
    const r = await app.inject({ method: "POST", url: "/api/account-login", headers: { origin: "https://demo.example" }, payload: { api_key } });
    assert.equal(r.statusCode, 200, r.body);
    const set = ([] as string[]).concat(r.headers["set-cookie"] as string[]);
    const cookie = set.find((c) => c.includes("pvd-session"))!.split(";")[0]!;
    const ws = set.find((c) => c.includes("pvd-demo-ws"))!.split(";")[0]!;
    const me = (await app.inject({ url: "/api/session", headers: { cookie } })).json<{ account: boolean; merchant_name: string; csrf: string; workspace: string }>();
    assert.equal(me.account, true);
    assert.equal(me.merchant_name, "Reelhouse Studio");
    assert.equal(me.workspace, tenant_id.slice(0, 8));
    // The merchant's own account, and full merchant access (keys are not blocked as in a demo).
    const acct = (await app.inject({ url: "/api/commerce/v1/account", headers: { cookie } })).json<{ tenant_id: string }>();
    assert.equal(acct.tenant_id, tenant_id);
    const keys = await app.inject({ url: "/api/commerce/v1/api-keys", headers: { cookie } });
    assert.equal(keys.statusCode, 200, keys.body);
    // Switching to the test buyer stays in the merchant's workspace.
    const buyer = await app.inject({ url: "/api/demo-login?as=buyer", headers: { cookie: ws } });
    assert.equal(buyer.statusCode, 302);
    const bc = ([] as string[]).concat(buyer.headers["set-cookie"] as string[]).find((c) => c.includes("pvd-session"))!.split(";")[0]!;
    assert.equal((await app.inject({ url: "/api/session", headers: { cookie: bc } })).json<{ workspace: string; role: string }>().workspace, tenant_id.slice(0, 8));
    // The 401 for a signed-out visitor says which sign-in options this deployment offers.
    assert.deepEqual((await app.inject({ url: "/api/session" })).json<{ demo_login: boolean; sso: boolean }>(), { message: "Sign in to access your deliveries", demo_login: true, sso: false });
  } finally {
    delete process.env.SIGNUP_MODE;
    await app.close();
    await db.close();
    await h.close();
  }
});
