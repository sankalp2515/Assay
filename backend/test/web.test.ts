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
