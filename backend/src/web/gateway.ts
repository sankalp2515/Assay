import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { Readable } from "node:stream";
import { token, authenticate, type Identity } from "../core/auth.js";
import type { Database } from "../core/database.js";
import { stableId, type Json } from "../domain/contracts.js";
import type { LoginProvider } from "./oidc.js";
export type Member = {
  role: "operator" | "buyer";
  subject: string;
  name?: string;
};
export interface GatewayOptions {
  origin: string;
  tenant: string;
  identity: Identity;
  db: Database;
  login: LoginProvider;
  members: Record<string, Member>;
  commerceUrl: string;
  deliveryUrl: string;
  assetsDir?: string;
  localOnly?: boolean;
  network?: typeof fetch;
  merchantName?: string;
  // Hosted Sandbox demo only: "Try as merchant / as buyer" without an identity provider.
  // Signs a visitor in as the configured demo member for that role. Never use with real
  // money or real customer data; /api/session reports demo: true so the UI can say so.
  demoLogin?: boolean;
  // Behind a reverse proxy (Caddy) the client address comes from X-Forwarded-For.
  trustProxy?: boolean;
}
const random = () => randomBytes(32).toString("base64url");
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const safeReturn = (value: unknown) =>
  typeof value === "string" &&
  /^\/#\/[a-zA-Z0-9/_-]*$/.test(value) &&
  value.length < 240
    ? value
    : "/#/batches";
const cookies = (header: string | undefined) =>
  Object.fromEntries(
    (header || "")
      .split(";")
      .map((x) => x.trim().split("="))
      .filter((x) => x.length === 2),
  );
export async function createGateway(options: GatewayOptions) {
  const o = options;
  const origin = new URL(o.origin);
  if (
    origin.origin !== o.origin ||
    (!o.localOnly && origin.protocol !== "https:")
  )
    throw Error("Gateway requires an exact HTTPS origin");
  if (o.localOnly && !["localhost", "127.0.0.1"].includes(origin.hostname))
    throw Error("Local gateway must use loopback");
  if (
    !/^[a-f0-9-]{36}$/i.test(o.tenant) ||
    Object.values(o.members).some(
      (m) =>
        !["operator", "buyer"].includes(m.role) ||
        !/^[a-f0-9-]{36}$/i.test(m.subject),
    )
  )
    throw Error("Invalid membership configuration");
  const cookieName = o.localOnly ? "pvd-local-session" : "__Host-pvd-session";
  const loginCookie = o.localOnly ? "pvd-local-login" : "__Host-pvd-login";
  const cookie = (name: string, value: string, maxAge: number) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${o.localOnly ? "" : "; Secure"}`;
  const app = Fastify({ logger: false, bodyLimit: 65536, trustProxy: o.trustProxy === true });
  // Inline scripts shipped in index.html (e.g. the theme switch) are allowed by exact hash,
  // so the policy never needs 'unsafe-inline'.
  const inlineHashes: string[] = [];
  if (o.assetsDir) {
    try {
      const html = await readFile(resolve(o.assetsDir, "index.html"), "utf8");
      for (const m of html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g))
        if (m[1]) inlineHashes.push("'sha256-" + createHash("sha256").update(m[1]).digest("base64") + "'");
    } catch {
      // No built index.html: nothing inline to allow.
    }
  }
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // PayPal JS SDK buttons (Sandbox and live hosts) load scripts, frames and calls.
        scriptSrc: ["'self'", ...inlineHashes, "https://www.paypal.com", "https://www.sandbox.paypal.com"],
        frameSrc: ["https://www.paypal.com", "https://www.sandbox.paypal.com"],
        childSrc: ["https://www.paypal.com", "https://www.sandbox.paypal.com"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", "data:"],
        imgSrc: ["'self'", "data:", "blob:", "https://www.paypalobjects.com", "https://t.paypal.com"],
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'", "https://www.paypal.com", "https://www.sandbox.paypal.com"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
  });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!o.localOnly)
      reply.header("Strict-Transport-Security", "max-age=31536000");
    if (
      o.localOnly &&
      !["localhost", "127.0.0.1"].includes(
        (req.headers.host || "").split(":")[0]!,
      )
    ) {
      reply.code(403).send({ message: "Loopback host required" });
    }
  });
  app.setErrorHandler((_err, _req, reply) =>
    reply
      .code(503)
      .send({
        message:
          "The service could not complete this request. Keep the original operation and try reading its status.",
      }),
  );
  async function session(req: { headers: Record<string, unknown> }) {
    const sid = cookies(req.headers.cookie as string)[cookieName];
    if (!sid || !/^[\w-]{43}$/.test(sid)) return null;
    const s = await o.db.get<Json>(o.tenant, "web_session", stableId(sid));
    if (!s || s.revoked || Number(s.expires_at) <= Date.now()) return null;
    // A demo session carries its own isolated workspace (tenant, merchant, buyer).
    if (s.demo === true)
      return o.demoLogin && typeof s.tenant === "string" && /^[a-f0-9-]{36}$/i.test(s.tenant) ? s : null;
    const member = o.members[String(s.oidc_subject)];
    if (!member || member.role !== s.role || member.subject !== s.subject) return null;
    return s;
  }
  // Hosted Sandbox demo: every visitor gets an isolated workspace, a tenant of their own
  // with its own merchant and buyer, so one visitor can never see or change another's
  // batches. It lives 24 hours (pointer cookie); switching role keeps the same workspace.
  const workspaceCookie = o.localOnly ? "pvd-demo-ws" : "__Host-pvd-demo-ws";
  const tenantOf = (s: Json) => (typeof s.tenant === "string" ? s.tenant : o.tenant);
  if (o.demoLogin) {
    app.get(
      "/api/demo-login",
      { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
      async (req, reply) => {
        const q = req.query as { as?: string; returnTo?: string };
        const role = q.as === "buyer" ? "buyer" : "operator";
        const wsid = cookies(req.headers.cookie as string)[workspaceCookie];
        let ws =
          wsid && /^[\w-]{43}$/.test(wsid)
            ? await o.db.get<Json>(o.tenant, "demo_workspace", stableId(wsid))
            : null;
        if (ws && Number(ws.expires_at) <= Date.now()) ws = null;
        let newWsid: string | undefined;
        if (!ws) {
          newWsid = random();
          const tenant = randomUUID();
          const operator = randomUUID();
          const buyer = randomUUID();
          // Commerce registers the new tenant with every service's worker.
          const r = await (o.network || fetch)(o.commerceUrl + "/v1/demo/workspace", {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(20000),
            headers: {
              Authorization: "Bearer " + (await token(o.identity, "commerce", tenant, "operator", operator)),
              "Content-Type": "application/json",
              "Idempotency-Key": "demo-ws-" + tenant,
            },
            body: JSON.stringify({ buyer_id: buyer }),
          });
          if (!r.ok) return reply.code(503).send({ message: "The demo workspace could not be created. Try again." });
          ws = { id: stableId(newWsid), tenant, operator, buyer, expires_at: Date.now() + 24 * 3600_000 };
          await o.db.create(o.tenant, "demo_workspace", newWsid, ws, ws);
        }
        const sid = random(),
          csrf = random();
        const record = {
          id: stableId(sid),
          oidc_subject: "demo:" + role,
          role,
          subject: role === "buyer" ? ws.buyer : ws.operator,
          tenant: ws.tenant,
          buyer_id: ws.buyer,
          name: role === "buyer" ? "Demo buyer" : "Demo merchant",
          csrf,
          demo: true,
          expires_at: Date.now() + 1800000,
          revoked: false,
        };
        await o.db.create(o.tenant, "web_session", sid, record, record);
        reply
          .header("Set-Cookie", [
            cookie(cookieName, sid, 1800),
            ...(newWsid ? [cookie(workspaceCookie, newWsid, 24 * 3600)] : []),
          ])
          .redirect(safeReturn(q.returnTo ?? (role === "buyer" ? "/#/buyer" : "/#/batches")));
      },
    );
  }
  app.get("/api/login", async (req, reply) => {
    const state = random(),
      nonce = random(),
      verifier = random();
    const input = {
      id: stableId(state),
      state: "PENDING",
      nonce,
      verifier,
      return_to: safeReturn((req.query as Json).returnTo),
      expires_at: Date.now() + 600000,
    };
    await o.db.create(o.tenant, "web_login", state, input, input);
    reply
      .header("Set-Cookie", cookie(loginCookie, state, 600))
      .redirect(o.login.authorization(state, nonce, verifier));
  });
  app.get("/api/callback", async (req, reply) => {
    const q = req.query as { state?: string; code?: string };
    const saved = cookies(req.headers.cookie)[loginCookie];
    if (!saved || !q.state || !equal(saved, q.state) || !q.code)
      return reply
        .code(400)
        .send({ message: "Sign-in response is invalid. Start sign-in again." });
    let login: Json;
    try {
      login = await o.db.mutate(
        o.tenant,
        "web_login",
        stableId(saved),
        async (row) => {
          if (row.state !== "PENDING" || Number(row.expires_at) <= Date.now())
            throw Error("Login expired");
          return { ...row, state: "CONSUMED" };
        },
      );
    } catch {
      return reply
        .code(400)
        .send({ message: "Sign-in response expired or already used." });
    }
    let subject: string;
    try {
      subject = await o.login.exchange(
        q.code,
        String(login.nonce),
        String(login.verifier),
      );
    } catch {
      return reply
        .code(401)
        .send({
          message: "Identity could not be verified. Start sign-in again.",
        });
    }
    const member = o.members[subject];
    if (!member)
      return reply
        .code(403)
        .send({
          message: "This identity has not been provisioned for this merchant.",
        });
    const sid = random(),
      csrf = random();
    const record = {
      id: stableId(sid),
      oidc_subject: subject,
      ...member,
      csrf,
      expires_at: Date.now() + 1800000,
      revoked: false,
    };
    await o.db.create(o.tenant, "web_session", sid, record, record);
    const prior = await session(req);
    if (prior)
      await o.db.mutate(
        o.tenant,
        "web_session",
        String(prior.id),
        async (s) => ({ ...s, revoked: true }),
      );
    reply
      .header("Set-Cookie", [
        cookie(cookieName, sid, 1800),
        cookie(loginCookie, "", 0),
      ])
      .redirect(safeReturn(login.return_to));
  });
  app.get("/api/session", async (req, reply) => {
    const s = await session(req);
    if (!s)
      return reply
        .code(401)
        // demo_login tells the page it can offer a one-click PayPal Sandbox workspace.
        .send({ message: "Sign in to access your deliveries", demo_login: o.demoLogin === true });
    return {
      role: s.role,
      subject: s.subject,
      csrf: s.csrf,
      expires_at: s.expires_at,
      environment: "sandbox",
      demo: s.demo === true,
      merchant_name: o.merchantName || "Demo merchant (Sandbox)",
    };
  });
  app.get("/api/directory", async (req, reply) => {
    const s = await session(req);
    if (!s) return reply.code(401).send({ message: "Sign in to continue" });
    if (s.role !== "operator")
      return reply.code(403).send({ message: "Merchant access required" });
    return {
      buyers: s.demo === true
        ? [{ id: String(s.buyer_id), name: "Demo buyer" }]
        : Object.values(o.members)
        .filter((m) => m.role === "buyer")
        .map((m) => ({
          id: m.subject,
          name: m.name || `Buyer ${m.subject.slice(0, 8)}`,
        })),
    };
  });
  app.post("/api/logout", async (req, reply) => {
    const s = await session(req);
    if (!s) return reply.code(401).send({ message: "Session expired" });
    if (
      req.headers.origin !== o.origin ||
      !equal(String(req.headers["x-csrf-token"] || ""), String(s.csrf))
    )
      return reply.code(403).send({ message: "Invalid session action" });
    await o.db.mutate(o.tenant, "web_session", String(s.id), async (row) => ({
      ...row,
      revoked: true,
    }));
    reply.header("Set-Cookie", cookie(cookieName, "", 0));
    return { signed_out: true };
  });
  // Public Commerce routes that need no session: the PayPal button configuration, the
  // statement verification keys, and merchant sign-up (Commerce decides whether sign-up
  // is open). Sign-up is same-origin only and limited per visitor here as well.
  const passThrough = async (
    method: "GET" | "POST",
    path: string,
    reply: { code: (n: number) => unknown; header: (k: string, v: string) => unknown; send: (b: unknown) => unknown },
    body?: unknown,
  ) => {
    const response = await (o.network || fetch)(o.commerceUrl + path, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: method === "POST" ? { "Content-Type": "application/json" } : {},
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
    });
    reply.code(response.status);
    reply.header("Content-Type", response.headers.get("content-type") || "application/json");
    return reply.send(await response.text());
  };
  app.get("/api/commerce/v1/paypal/config", async (_req, reply) =>
    passThrough("GET", "/v1/paypal/config", reply),
  );
  app.get("/api/commerce/v1/statements/keys", async (_req, reply) =>
    passThrough("GET", "/v1/statements/keys", reply),
  );
  app.post(
    "/api/commerce/v1/signup",
    { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (req, reply) => {
      if (req.headers.origin !== o.origin)
        return reply.code(403).send({ message: "Sign up from this site" });
      return passThrough("POST", "/v1/signup", reply, req.body);
    },
  );
  app.route({
    method: ["GET", "POST"],
    url: "/api/:service/*",
    handler: async (req, reply) => {
      const s = await session(req);
      if (!s)
        return reply
          .code(401)
          .send({ message: "Your session expired. Sign in to continue." });
      if (
        req.method !== "GET" &&
        (req.headers.origin !== o.origin ||
          !equal(String(req.headers["x-csrf-token"] || ""), String(s.csrf)))
      )
        return reply
          .code(403)
          .send({ message: "Request origin or CSRF token is invalid" });
      const p = req.params as { service: string; "*": string };
      const path = "/" + p["*"];
      if (
        !["commerce", "delivery"].includes(p.service) ||
        !/^\/v1\/[a-zA-Z0-9/_-]+$/.test(path) ||
        (p.service === "commerce" &&
          !/^\/v1\/(batches|operations|readiness|controls|support|account|api-keys|buyer-sessions|merchant|statements\/verify|paypal\/config|demo)(\/|$)/.test(
            path,
          ))
      )
        return reply.code(404).send({ message: "Route not found" });
      let authorization: string;
      // Demo sessions get the walkthrough only: no payment controls, keys or account links.
      if (
        s.demo === true &&
        p.service === "commerce" &&
        /^\/v1\/(controls|api-keys|merchant|buyer-sessions)(\/|$)/.test(path)
      )
        return reply.code(403).send({ message: "Not available in the Sandbox demo" });
      if (p.service === "delivery") {
        if (
          req.method !== "GET" ||
          !/^\/v1\/artifacts\/[a-f0-9-]+\/content$/.test(path)
        )
          return reply.code(404).send({ message: "Route not found" });
        try {
          const actor = await authenticate(
            req.headers.authorization,
            o.identity,
            "delivery",
          );
          if (
            actor.tenant !== tenantOf(s) ||
            (s.role === "buyer" && actor.subject !== s.subject)
          )
            throw Error();
        } catch {
          return reply.code(403).send({ message: "File access denied" });
        }
        authorization = req.headers.authorization!;
      } else
        authorization =
          "Bearer " +
          (await token(
            o.identity,
            "commerce",
            tenantOf(s),
            String(s.role),
            String(s.subject),
          ));
      const search = new URL(req.url, o.origin).search;
      const response = await (o.network || fetch)(
        (p.service === "commerce" ? o.commerceUrl : o.deliveryUrl) +
          path +
          search,
        {
          method: req.method,
          redirect: "error",
          signal: AbortSignal.timeout(30000),
          headers: {
            Authorization: authorization,
            ...(req.method === "POST"
              ? {
                  "Content-Type": "application/json",
                  "Idempotency-Key": String(
                    req.headers["idempotency-key"] || "",
                  ),
                }
              : {}),
          },
          ...(req.method === "POST"
            ? { body: JSON.stringify(req.body ?? {}) }
            : {}),
        },
      );
      reply.code(response.status);
      reply.header(
        "Content-Type",
        response.headers.get("content-type") || "application/octet-stream",
      );
      return response.body
        ? reply.send(Readable.fromWeb(response.body as never))
        : reply.send();
    },
  });
  if (o.assetsDir) {
    const base = await realpath(o.assetsDir);
    // The bare root is not matched by the wildcard route.
    app.get("/", async (_req, reply) =>
      reply.type("text/html; charset=utf-8").send(await readFile(resolve(base, "index.html"))),
    );
    app.get("/*", async (req, reply) => {
      let path: string;
      try {
        path = decodeURIComponent(new URL(req.url, o.origin).pathname);
      } catch {
        return reply.code(400).send();
      }
      if (path.startsWith("/api/") || path.startsWith("/__local/"))
        return reply.code(404).send();
      const target = resolve(base, "." + path);
      if (target !== base && !target.startsWith(base + sep))
        return reply.code(404).send();
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript",
        ".css": "text/css",
        ".png": "image/png",
        ".webp": "image/webp",
        ".woff2": "font/woff2",
        ".mp4": "video/mp4",
        ".svg": "image/svg+xml",
      };
      try {
        const actual = await realpath(target);
        if (!actual.startsWith(base + sep)) return reply.code(404).send();
        const bytes = await readFile(actual);
        return reply
          .type(mime[extname(actual)] || "application/octet-stream")
          .send(bytes);
      } catch {
        if (path.includes(".")) return reply.code(404).send();
        return reply
          .type("text/html; charset=utf-8")
          .send(await readFile(resolve(base, "index.html")));
      }
    });
  }
  await app.ready();
  return app;
}
