import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import { z } from "zod";
import { authenticate, authorize, type Actor } from "./auth.js";
import { Problem, requireThat } from "./errors.js";
import type { Context } from "./context.js";
import type { Json } from "../domain/contracts.js";
import { logOptions } from "./logging.js";
import { looksLikeCredential, resolveCredential } from "./apikeys.js";
import { registerTenant } from "./tenants.js";
declare module "fastify" {
  interface FastifyRequest {
    actor: Actor;
  }
}
export type Handler = (
  actor: Actor,
  body: unknown,
  params: Record<string, string>,
  key: string,
  request: FastifyRequest,
) => Promise<unknown>;
export function endpoint(
  app: FastifyInstance,
  ctx: Context,
  method: "GET" | "POST",
  path: string,
  issuers: string[],
  roles: string[] | undefined,
  handler: Handler,
  bodySchema?: z.ZodType,
) {
  const body = bodySchema ? z.toJSONSchema(bodySchema) : undefined;
  if (body) delete body.$schema;
  app.route({
    method,
    url: path,
    schema: {
      tags: [ctx.name],
      summary: path,
      ...(body ? { body } : {}),
      response: { 200: { type: "object", additionalProperties: true } },
    },
    preHandler: async (req) => {
      // Merchant API keys and buyer sessions are accepted only at Commerce, on public
      // routes. Internal service routes still require a signed service token.
      req.actor =
        ctx.name === "commerce" &&
        path.startsWith("/v1/") &&
        looksLikeCredential(req.headers.authorization)
          ? await resolveCredential(
              ctx,
              req.headers.authorization!,
              req.url.split("?")[0]!,
            )
          : await authenticate(req.headers.authorization, ctx.identity, ctx.name);
      authorize(req.actor, issuers, roles);
      if (method === "POST")
        requireThat(
          typeof req.headers["idempotency-key"] === "string" &&
            /^[\w.:\-]{8,128}$/.test(req.headers["idempotency-key"]),
          "idempotency_required",
          "Supply an Idempotency-Key of 8–128 safe characters",
          400,
        );
    },
    handler: async (req) =>
      handler(
        req.actor,
        bodySchema ? bodySchema.parse(req.body) : req.body,
        (req.params ?? {}) as Record<string, string>,
        String(req.headers["idempotency-key"] ?? ""),
        req,
      ),
  });
}
export async function foundation(ctx: Context) {
  const app = Fastify({
    bodyLimit: 64 * 1024,
    requestTimeout: 30000,
    logger: logOptions(ctx.name, !ctx.fixture),
    trustProxy: false,
    genReqId: () => crypto.randomUUID(),
  });
  await app.register(helmet);
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: {
      info: { title: `Assay — ${ctx.name} service`, version: "0.1.0" },
      components: {
        securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      },
      security: [{ bearerAuth: [] }],
    },
  });
  app.setErrorHandler((e, req, reply) => {
    const error = e as Error & {
      validation?: unknown;
      statusCode?: number;
      code?: string;
    };
    const status =
      e instanceof Problem
        ? e.status
        : e instanceof z.ZodError || error.validation
          ? 400
          : error.code === "23505"
            ? 409
            : error.statusCode === 429
              ? 429
              : 500;
    // Unexpected failures are logged by type and code only; messages may carry data.
    if (status >= 500)
      req.log.error(
        { err_type: error.name, err_code: error.code, trace_id: req.id },
        "request failed",
      );
    reply
      .code(status)
      .send({
        code:
          e instanceof Problem
            ? e.code
            : status === 400
              ? "invalid_request"
              : status === 429
                ? "rate_limited"
                : "internal_error",
        message:
          e instanceof Problem
            ? e.message
            : status === 400
              ? "Request does not match the API contract"
              : "Request could not be completed",
        trace_id: req.id,
        retryable: status >= 500,
      });
  });
  app.get("/health", async () => ({
    service: ctx.name,
    status: "alive",
    environment: ctx.fixture ? "fixture" : "sandbox",
  }));
  app.get("/ready", async (_req, reply) => {
    try {
      await ctx.db.admin.query("SELECT 1");
      return {
        service: ctx.name,
        database: "ready",
        integration_configured:
          ctx.name === "payments"
            ? (ctx.paypal?.available ?? false)
            : ctx.name === "provider"
              ? (ctx.provider?.available ?? false)
              : ctx.name === "investigation"
                ? (ctx.model?.available ?? false)
                : true,
      };
    } catch {
      return reply.code(503).send({ status: "database_unavailable" });
    }
  });
  app.get("/openapi.json", async () => app.swagger());
  endpoint(
    app,
    ctx,
    "GET",
    "/internal/metrics",
    ["commerce"],
    undefined,
    async (actor) =>
      ctx.db.tx(actor.tenant, async (q) => {
        const outbox = await q.query(
          "SELECT state,count(*)::int AS count FROM outbox GROUP BY state",
        );
        return { service: ctx.name, outbox: outbox.rows };
      }),
  );
  // Commerce announces a newly signed-up tenant so this service's worker serves it.
  endpoint(app, ctx, "POST", "/internal/tenants", ["commerce"], undefined, async (actor, raw) => {
    const e = (raw as { expires_at?: unknown } | undefined)?.expires_at;
    await registerTenant(ctx, actor.tenant, typeof e === "string" && !Number.isNaN(Date.parse(e)) ? e : undefined);
    return { registered: actor.tenant };
  });
  return app;
}
export function safeRecord(v: unknown): Json {
  requireThat(
    v && typeof v === "object" && !Array.isArray(v),
    "invalid_resource",
    "Invalid upstream resource",
    502,
  );
  return v as Json;
}
