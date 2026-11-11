import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Context } from "../core/context.js";
import { endpoint } from "../core/http.js";
import { Problem, requireThat } from "../core/errors.js";
import { newCredential, storedCredential } from "../core/apikeys.js";
import { emitEvent } from "../core/webhooks.js";
import { now, stableId, uuid, type Json } from "../domain/contracts.js";
import { CURRENCIES } from "../domain/money.js";
import { PLATFORM_TENANT, registerTenant } from "../core/tenants.js";
import { publicProbe } from "./playback.js";
// Singleton rows per tenant use a fixed, valid entity id.
const CURRENT = stableId("singleton");

// Merchant self-service at Commerce: sign-up, API keys, buyer sessions, the merchant's own
// PayPal connection, disputes and the public PayPal button configuration.
const signupMode = () => {
  const m = process.env.SIGNUP_MODE ?? "closed";
  return m === "open" || m === "invite" ? m : "closed";
};
const sameText = (a: string, b: string) =>
  a.length === b.length && stableId(a) === stableId(b);

export function accountRoutes(app: FastifyInstance, ctx: Context) {
  // ---- Sign-up. Closed by default; "invite" needs SIGNUP_INVITE_CODE; "open" is for a
  // hosted Sandbox demo only. Every account is a new tenant with its own data scope.
  app.post(
    "/v1/signup",
    {
      // Per address. Behind the web gateway every request shares the gateway's address,
      // so a hosted deployment raises this and the gateway limits each visitor instead.
      config: {
        rateLimit: {
          max: Math.max(1, Math.min(500, Number(process.env.SIGNUP_RATE_PER_HOUR ?? 5) || 5)),
          timeWindow: "1 hour",
        },
      },
      schema: {
        tags: ["commerce"],
        security: [],
        summary: "Create a Sandbox merchant account and its first API key (shown once)",
      },
    },
    async (req, reply) => {
      const mode = signupMode();
      if (mode === "closed")
        throw new Problem(403, "signup_closed", "Sign-up is not open on this deployment");
      const b = z
        .strictObject({
          merchant_name: z.string().trim().min(2).max(80),
          email: z.email().max(200),
          invite_code: z.string().max(200).optional(),
        })
        .parse(req.body);
      if (mode === "invite") {
        const code = process.env.SIGNUP_INVITE_CODE ?? "";
        requireThat(
          code.length >= 12 && sameText(b.invite_code ?? "", code),
          "invite_required",
          "A valid invite code is required",
          403,
        );
      }
      const email = b.email.toLowerCase();
      const registry = stableId({ account_email: email });
      const tenant = randomUUID();
      const operator = randomUUID();
      const key = newCredential("sk", tenant);
      await ctx.db.tx(PLATFORM_TENANT, async (q) => {
        const taken = await ctx.db.getIn<Json>(q, PLATFORM_TENANT, "merchant_account", registry);
        requireThat(!taken, "account_exists", "An account with this email already exists");
      });
      // Every service's worker must serve the new tenant before any work is accepted.
      await registerTenant(ctx, tenant);
      for (const service of ["provider", "delivery", "investigation", "payments"] as const)
        await ctx.call(service, "/internal/tenants", tenant, {}, "tenant-" + tenant);
      await ctx.db.tx(PLATFORM_TENANT, async (q) => {
        await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["signup" + registry]);
        const taken = await ctx.db.getIn<Json>(q, PLATFORM_TENANT, "merchant_account", registry, true);
        requireThat(!taken, "account_exists", "An account with this email already exists");
        await ctx.db.put(q, PLATFORM_TENANT, "merchant_account", registry, {
          id: registry,
          tenant_id: tenant,
          created_at: now(),
        });
      });
      await ctx.db.tx(tenant, async (q) => {
        await ctx.db.put(q, tenant, "account", CURRENT, {
          id: CURRENT,
          merchant_name: b.merchant_name,
          email,
          operator_id: operator,
          environment: "sandbox",
          created_at: now(),
        });
        await ctx.db.put(q, tenant, "api_key", key.id, {
          id: key.id,
          name: "First key",
          scope: "operator",
          prefix: key.prefix,
          operator_id: operator,
          created_at: now(),
          ...storedCredential(key.value),
        });
      });
      return reply.code(201).send({
        tenant_id: tenant,
        operator_id: operator,
        merchant_name: b.merchant_name,
        environment: "sandbox",
        api_key: key.value,
        api_key_id: key.id,
        api_key_scope: "operator",
        note: "Store this key now; it is not shown again. Use it as `Authorization: Bearer <key>` from your server only.",
      });
    },
  );
  endpoint(app, ctx, "GET", "/v1/account", ["operator"], ["operator", "integration"], async (a) => {
    const acct = await ctx.db.get<Json>(a.tenant, "account", CURRENT);
    return {
      tenant_id: a.tenant,
      merchant_name: acct?.merchant_name ?? null,
      environment: "sandbox",
      role: a.role,
      currencies: CURRENCIES,
      signup: acct ? "self-serve" : "provisioned",
    };
  });

  // ---- API keys. Rotation is: create the new key, deploy it, revoke the old one.
  endpoint(
    app,
    ctx,
    "POST",
    "/v1/api-keys",
    ["operator"],
    ["operator"],
    async (a, raw, _p, idem) => {
      const b = raw as { name: string; scope: "operator" | "integration" };
      const prior = await ctx.db.get<Json>(a.tenant, "api_key_request", stableId({ idem }));
      requireThat(!prior, "idempotency_conflict", "This key request was already used; secrets are shown once");
      const key = newCredential("sk", a.tenant);
      await ctx.db.tx(a.tenant, async (q) => {
        await ctx.db.put(q, a.tenant, "api_key_request", stableId({ idem }), { id: stableId({ idem }), key_id: key.id });
        await ctx.db.put(q, a.tenant, "api_key", key.id, {
          id: key.id,
          name: b.name,
          scope: b.scope,
          prefix: key.prefix,
          operator_id: a.subject,
          created_at: now(),
          ...storedCredential(key.value),
        });
      });
      return { id: key.id, name: b.name, scope: b.scope, api_key: key.value, prefix: key.prefix };
    },
    z.strictObject({
      name: z.string().trim().min(1).max(60),
      scope: z.enum(["operator", "integration"]),
    }),
  );
  endpoint(app, ctx, "GET", "/v1/api-keys", ["operator"], ["operator"], async (a) => ({
    keys: (await ctx.db.list<Json>(a.tenant, "api_key")).map((k) => ({
      id: k.id,
      name: k.name,
      scope: k.scope,
      prefix: k.prefix,
      created_at: k.created_at,
      revoked_at: k.revoked_at ?? null,
    })),
  }));
  endpoint(
    app,
    ctx,
    "POST",
    "/v1/api-keys/:key/revoke",
    ["operator"],
    ["operator"],
    async (a, _b, p) =>
      ctx.db
        .mutate<Json>(a.tenant, "api_key", uuid.parse(p.key), async (k) =>
          k.revoked_at ? k : { ...k, revoked_at: now() },
        )
        .then((k) => ({ id: k.id, revoked_at: k.revoked_at })),
  );

  // ---- Buyer sessions: the merchant's server vouches for its own logged-in buyer.
  endpoint(
    app,
    ctx,
    "POST",
    "/v1/buyer-sessions",
    ["operator"],
    ["operator", "integration"],
    async (a, raw) => {
      const b = raw as { batch_id: string; buyer_id: string };
      const batch = await ctx.db.get<Json>(a.tenant, "batch", b.batch_id);
      requireThat(batch && batch.buyer_id === b.buyer_id, "not_found", "Batch not found for this buyer", 404);
      const s = newCredential("bt", a.tenant);
      const expires = new Date(ctx.now() + 30 * 60_000).toISOString();
      await ctx.db.tx(a.tenant, async (q) =>
        ctx.db.put(q, a.tenant, "buyer_session", s.id, {
          id: s.id,
          batch_id: b.batch_id,
          buyer_id: b.buyer_id,
          created_by: a.subject,
          expires_at: expires,
          created_at: now(),
          ...storedCredential(s.value),
        }),
      );
      return { buyer_token: s.value, batch_id: b.batch_id, expires_at: expires };
    },
    z.strictObject({ batch_id: uuid, buyer_id: uuid }),
  );

  // ---- Public PayPal button configuration. The client id is public by design; the
  // secret never leaves Payments. Orders are always created server-side.
  app.get(
    "/v1/paypal/config",
    { schema: { tags: ["commerce"], security: [], summary: "Public PayPal JS SDK configuration" } },
    async () => ({
      client_id: process.env.PAYPAL_CLIENT_ID || null,
      environment: "sandbox",
      intent: "authorize",
      // Default only; the SDK must load with the batch's own currency (batch.currency).
      currency: "USD",
      currencies: CURRENCIES,
      create_order: "POST /v1/batches/{id}/paypal/order",
      on_approve: "POST /v1/batches/{id}/paypal/authorize",
    }),
  );

  // ---- The merchant's own PayPal account (partner onboarding).
  endpoint(app, ctx, "GET", "/v1/merchant/paypal", ["operator"], ["operator"], async (a) =>
    ctx.call("payments", "/internal/merchant/paypal", a.tenant),
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/v1/merchant/paypal/onboarding",
    ["operator"],
    ["operator"],
    async (a, raw, _p, key) => ctx.call("payments", "/internal/merchant/paypal/onboarding", a.tenant, raw as Json, key),
    z.strictObject({ return_url: z.string().regex(/^https?:\/\/\S+$/).max(500) }),
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/v1/merchant/paypal/complete",
    ["operator"],
    ["operator"],
    async (a, raw, _p, key) => ctx.call("payments", "/internal/merchant/paypal/complete", a.tenant, raw as Json, key),
    z.strictObject({ merchant_id: z.string().regex(/^[A-Z0-9]{8,20}$/) }),
  );

  // ---- External playback proof (KERNEL). The merchant sees the replay link; the buyer
  // sees only the outcome for their own batch.
  endpoint(
    app,
    ctx,
    "GET",
    "/v1/batches/:batch/playback",
    ["operator"],
    ["operator", "integration", "buyer"],
    async (a, _b, p) => {
      const batch = uuid.parse(p.batch);
      const b = await ctx.db.get<Json>(a.tenant, "batch", batch);
      requireThat(b && (a.role !== "buyer" || b.buyer_id === a.subject), "not_found", "Batch not found", 404);
      const r = (await ctx.call("delivery", "/internal/batches/" + batch + "/playback", a.tenant)) as {
        enabled: boolean;
        probes: Json[];
      };
      return {
        enabled: r.enabled,
        what: "A real Chromium browser outside Assay's network (KERNEL) fetched each delivered clip over the public internet, compared its SHA-256 with the archived original, and played it. Settlement never depends on this.",
        probes: r.probes.map((x) =>
          a.role === "buyer" ? publicProbe(x) : { ...publicProbe(x), replay_view_url: x.replay_view_url ?? null, error: x.error ?? null },
        ),
      };
    },
  );

  // ---- Disputes: PayPal's record, plus the evidence the merchant attaches in PayPal.
  endpoint(app, ctx, "GET", "/v1/batches/:batch/disputes", ["operator"], ["operator"], async (a, _b, p) => {
    const batch = uuid.parse(p.batch);
    const { disputes } = (await ctx.call("payments", "/internal/batches/" + batch + "/disputes", a.tenant)) as {
      disputes: Json[];
    };
    const playback = (await ctx.call("delivery", "/internal/batches/" + batch + "/playback", a.tenant)) as {
      probes: Json[];
    };
    let statement: Json | null = null;
    try {
      statement = await ctx.call("payments", "/internal/batches/" + batch + "/statement", a.tenant);
    } catch {
      statement = null;
    }
    return {
      disputes,
      refunds_paused: disputes.some((d) => d.status !== "RESOLVED"),
      // Independent real-browser playback of each delivered clip (KERNEL), when enabled.
      playback_evidence: playback.probes.map(publicProbe),
      evidence: statement?.signed
        ? {
            kind: "signed per-clip delivery statement",
            statement_digest: statement.statement_digest,
            jws: statement.jws,
            verify_with: "GET /v1/statements/keys",
            how_to_use:
              "Attach the statement to your response in the PayPal Resolution Center. It lists each clip, its file digest and the buyer's retrieval receipt.",
          }
        : null,
    };
  });
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/disputes/notify",
    ["payments"],
    undefined,
    async (a, raw) => {
      const b = raw as Json;
      const status = String(b.status);
      const type = status === "RESOLVED" ? "dispute.resolved" : b.first ? "dispute.opened" : "dispute.updated";
      await ctx.db.tx(a.tenant, (q) =>
        emitEvent(ctx, q, a.tenant, type, stableId({ dispute_event: b.event_key }), {
          batch_id: b.batch_id,
          dispute_id: b.dispute_id,
          status,
          reason: b.reason,
          amount: b.amount ?? null,
          seller_response_due_date: b.seller_response_due_date ?? null,
          evidence_path: "/v1/batches/" + String(b.batch_id) + "/disputes",
        }),
      );
      return { notified: true };
    },
  );
}
