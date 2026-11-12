import type { FastifyInstance } from "fastify";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context } from "../core/context.js";
import { endpoint } from "../core/http.js";
import { Problem, requireThat } from "../core/errors.js";
import { now, stableId, type Json } from "../domain/contracts.js";
import { PLATFORM_TENANT } from "../core/tenants.js";

// Provider connectors: the provider calls Assay the moment a render completes, so the
// original is archived in seconds instead of after a polling interval. Today: Replicate,
// whose prediction webhooks follow the Standard Webhooks signature scheme.
//
// The webhook is only a prompt to look. Assay never trusts its body: it finds the task the
// merchant registered, then the normal archive job reads the prediction back from
// Replicate with the merchant's own token before downloading anything.
const TASK_INDEX = "provider_task_index";
const HOOK = "provider_hook";

export const taskIndexKey = (source: string, task: string) => stableId({ provider_task: source + ":" + task });

// Called from task registration, in the same transaction as the batch update.
export async function indexTask(
  ctx: Context,
  q: Parameters<Context["db"]["put"]>[0],
  tenant: string,
  source: string,
  task: string,
  batchId: string,
  attemptId: string,
  deliver: boolean,
) {
  const key = taskIndexKey(source, task);
  await ctx.db.put(q, tenant, TASK_INDEX, key, { id: key, source, task, batch_id: batchId, attempt_id: attemptId, deliver });
}

// Standard Webhooks: signature = base64(HMAC-SHA256(secret, `${id}.${timestamp}.${body}`)),
// header "v1,<sig> [v1,<sig> ...]", secret "whsec_<base64>".
export function verifyStandardWebhook(
  secret: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  raw: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (!secret.startsWith("whsec_") || !headers.id || !headers.timestamp || !headers.signature) return false;
  const t = Number(headers.timestamp);
  if (!Number.isInteger(t) || Math.abs(nowSeconds - t) > 300) return false;
  const key = Buffer.from(secret.slice(6), "base64");
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${raw}`).digest();
  return headers.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export function connectorRoutes(app: FastifyInstance, ctx: Context) {
  // The merchant asks for its Replicate webhook URL and passes it as `webhook` (with
  // webhook_events_filter ["completed"]) when creating each prediction.
  endpoint(app, ctx, "POST", "/v1/connect/replicate", ["operator"], ["operator"], async (a) => {
    requireThat(process.env.REPLICATE_WEBHOOK_SECRET?.startsWith("whsec_"), "connector_unconfigured", "Set REPLICATE_WEBHOOK_SECRET (from GET https://api.replicate.com/v1/webhooks/default/secret) first", 409);
    const existing = await ctx.db.get<Json>(a.tenant, HOOK, stableId({ hook: "replicate" }));
    let hook = typeof existing?.hook === "string" ? existing.hook : undefined;
    if (!hook) {
      hook = randomBytes(24).toString("base64url");
      await ctx.db.tx(PLATFORM_TENANT, (q) =>
        ctx.db.put(q, PLATFORM_TENANT, HOOK, stableId({ hook }), { id: stableId({ hook }), tenant_id: a.tenant, provider: "replicate" }),
      );
      await ctx.db.tx(a.tenant, (q) =>
        ctx.db.put(q, a.tenant, HOOK, stableId({ hook: "replicate" }), { id: stableId({ hook: "replicate" }), hook, created_at: now() }),
      );
    }
    return {
      provider: "replicate",
      webhook_url: ctx.publicOrigin.replace(/\/+$/, "") + "/v1/providers/replicate/webhook/" + hook,
      how: 'Pass webhook_url as "webhook" and ["completed"] as "webhook_events_filter" when you create a prediction, and register the prediction with POST /v1/batches/{id}/tasks (source "replicate").',
    };
  });

  // Public receiver. Raw body is needed for the signature, so this lives in its own scope.
  app.register(async (scope) => {
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));
    scope.post(
      "/v1/providers/replicate/webhook/:hook",
      {
        config: { rateLimit: { max: 600, timeWindow: "1 minute" } },
        schema: { tags: ["commerce"], security: [], summary: "Replicate prediction webhook (Standard Webhooks signature)" },
      },
      async (req, reply) => {
        const raw = typeof req.body === "string" ? req.body : "";
        const h = req.headers;
        const ok = verifyStandardWebhook(process.env.REPLICATE_WEBHOOK_SECRET ?? "", {
          id: h["webhook-id"] as string | undefined,
          timestamp: h["webhook-timestamp"] as string | undefined,
          signature: h["webhook-signature"] as string | undefined,
        }, raw);
        if (!ok) throw new Problem(401, "invalid_webhook", "Webhook signature verification failed");
        const hook = String((req.params as { hook: string }).hook);
        if (!/^[\w-]{32}$/.test(hook)) throw new Problem(404, "not_found", "Unknown webhook");
        const owner = await ctx.db.get<Json>(PLATFORM_TENANT, HOOK, stableId({ hook }));
        if (typeof owner?.tenant_id !== "string") throw new Problem(404, "not_found", "Unknown webhook");
        const tenant = owner.tenant_id;
        let prediction: Json;
        try {
          prediction = JSON.parse(raw) as Json;
        } catch {
          throw new Problem(400, "invalid_request", "Body is not JSON");
        }
        const task = typeof prediction.id === "string" && /^[\w-]{4,100}$/.test(prediction.id) ? prediction.id : undefined;
        if (!task) throw new Problem(400, "invalid_request", "Missing prediction id");
        const index = await ctx.db.get<Json>(tenant, TASK_INDEX, taskIndexKey("replicate", task));
        // Unknown predictions are acknowledged: the merchant may not have registered it yet.
        if (!index) return reply.code(202).send({ accepted: true, matched: false });
        const eventKey = stableId({ replicate_webhook: String(h["webhook-id"]) });
        await ctx.db.tx(tenant, async (q) => {
          if (await ctx.db.getIn(q, tenant, "provider_webhook", eventKey, true)) return; // retry of a delivered event
          await ctx.db.put(q, tenant, "provider_webhook", eventKey, { id: eventKey, provider: "replicate", task, received_at: now() });
          await ctx.db.enqueue(q, tenant, "commerce", "/internal/tasks/archive", {
            batch_id: index.batch_id,
            attempt_id: index.attempt_id,
            ...(index.deliver ? { deliver: true } : {}),
          });
        });
        return reply.code(200).send({ accepted: true, matched: true });
      },
    );
  });
}
