import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { randomBytes, timingSafeEqual } from "node:crypto";
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
  const app = Fastify({ logger: false, bodyLimit: 65536, trustProxy: false });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'"],
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
    const member = s ? o.members[String(s.oidc_subject)] : undefined;
    if (
      !s ||
      s.revoked ||
      Number(s.expires_at) <= Date.now() ||
      !member ||
      member.role !== s.role ||
      member.subject !== s.subject
    )
      return null;
    return s;
  }
  if (o.demoLogin) {
    app.get(
      "/api/demo-login",
      { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
      async (req, reply) => {
        const q = req.query as { as?: string; returnTo?: string };
        const role = q.as === "buyer" ? "buyer" : "operator";
        const entry = Object.entries(o.members).find(([, m]) => m.role === role);
        if (!entry) return reply.code(404).send({ message: "No demo member for this role" });
        const [subject, member] = entry;
        const sid = random(),
          csrf = random();
        const record = {
          id: stableId(sid),
          oidc_subject: subject,
          ...member,
          csrf,
          demo: true,
          expires_at: Date.now() + 1800000,
          revoked: false,
        };
        await o.db.create(o.tenant, "web_session", sid, record, record);
        reply
          .header("Set-Cookie", cookie(cookieName, sid, 1800))
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
        .send({ message: "Sign in to access your deliveries" });
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
      buyers: Object.values(o.members)
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
          !/^\/v1\/(batches|operations|readiness|controls|support|account|api-keys|buyer-sessions|merchant)(\/|$)/.test(
            path,
          ))
      )
        return reply.code(404).send({ message: "Route not found" });
      let authorization: string;
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
            actor.tenant !== o.tenant ||
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
            o.tenant,
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
