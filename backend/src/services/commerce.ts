import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Context } from "../core/context.js";
import { endpoint } from "../core/http.js";
import { token } from "../core/auth.js";
import { emitEvent } from "../core/webhooks.js";
import { Problem, requireThat } from "../core/errors.js";
import {
  batchInput,
  eligibleAmount,
  id,
  uuid,
  now,
  digest,
  stableId,
  type Batch,
  type Json,
  type Permit,
  type Evidence,
} from "../domain/contracts.js";
// Exact-amount approvals expire quickly so a stale review can't be approved. 45 seconds by
// default; a demo or slower operator team may set 30-600 seconds.
function approvalWindowMs() {
  const s = Number(process.env.APPROVAL_WINDOW_SECONDS ?? 45);
  return Math.min(600, Math.max(30, Number.isFinite(s) ? s : 45)) * 1000;
}
export function commerceRoutes(app: FastifyInstance, ctx: Context) {
  endpoint(
    app,
    ctx,
    "POST",
    "/v1/controls/payments",
    ["operator"],
    ["operator"],
    async (a, raw, _p, key) =>
      ctx.call(
        "payments",
        "/internal/dispatch-control",
        a.tenant,
        raw as Json,
        key,
      ),
    z.strictObject({
      paused: z.boolean(),
      reason: z.string().min(10).max(500),
    }),
  );
  async function batch(tenant: string, key: string) {
    const b = await ctx.db.get<Batch>(tenant, "batch", uuid.parse(key));
    requireThat(b, "not_found", "Batch not found", 404);
    return b;
  }
  async function snapshot(tenant: string, b: Batch) {
    const attempts = (
      await ctx.call(
        "provider",
        "/internal/batches/" + b.id + "/attempts",
        tenant,
      )
    ).attempts as Json[];
    const artifacts = (
      await ctx.call(
        "delivery",
        "/internal/batches/" + b.id + "/artifacts",
        tenant,
      )
    ).artifacts as Json[];
    const operations = (
      await ctx.call(
        "payments",
        "/internal/batches/" + b.id + "/operations",
        tenant,
      )
    ).operations as Json[];
    const stable = {
      contract_hash: b.contract_hash,
      attempts: attempts.map((a) => ({
        id: a.id,
        unit_id: a.unit_id,
        state: a.state,
        provider_task_id: a.provider_task_id,
      })),
      artifacts,
      operations: operations.map((o) => ({
        id: o.id,
        kind: o.kind,
        state: o.state,
        amount_minor: o.amount_minor,
      })),
    };
    const evidence: Evidence[] = [
      {
        id: id(),
        source: "commerce",
        unit_id: null,
        text: `Accepted contract ${b.contract_hash}: technical validity and purchaser retrievability determine billability; actual viewing and subjective creative satisfaction are not required.`,
      },
    ];
    for (const attempt of attempts)
      evidence.push({
        id: id(),
        source: "provider",
        unit_id: String(attempt.unit_id),
        text: `Attempt ${attempt.id} for unit ${attempt.unit_id} has provider task ${String(attempt.provider_task_id ?? "UNKNOWN")} and state ${attempt.state}.`,
      });
    for (const artifact of artifacts)
      evidence.push({
        id: id(),
        source: "delivery",
        unit_id: String(artifact.unit_id),
        text: `Artifact ${artifact.id} for unit ${artifact.unit_id} is ${artifact.state}; published to purchaser: ${artifact.published === true}; digest ${String(artifact.sha256 ?? "unverified")}.`,
      });
    for (const op of operations)
      evidence.push({
        id: id(),
        source: "payments",
        unit_id: null,
        text: `Payment operation ${op.id} is ${op.kind} with state ${op.state}. A pending or unknown operation is not confirmed cash.`,
      });
    const hash = digest(stable);
    // Re-reading unchanged facts must preserve observation identities, so a retried
    // assessment command has the same payload and citations remain traceable.
    return {
      hash,
      evidence: evidence.map((e) => ({
        ...e,
        id: stableId({
          snapshot_hash: hash,
          source: e.source,
          unit_id: e.unit_id,
          text: e.text,
        }),
      })),
      artifacts,
    };
  }
  endpoint(
    app,
    ctx,
    "POST",
    "/v1/batches",
    ["operator"],
    ["operator"],
    async (a, raw, _p, key) => {
      const b = batchInput.parse(raw);
      const units = Array.from({ length: b.unit_count }, () => ({
        id: id(),
        price_minor: b.unit_price_minor,
      }));
      const keyId = id();
      const terms = {
        buyer_id: b.buyer_id,
        units,
        currency: b.currency,
        technical: {
          codec: "h264",
          min_height: 720,
          min_seconds: 4,
          max_seconds: 10,
          max_bytes: 25 * 1024 * 1024,
        },
        retention_days: 7,
        billable: "ready-and-purchaser-retrievable",
        creative_quality_guaranteed: false,
      };
      const record: Batch = {
        id: keyId,
        buyer_id: b.buyer_id,
        units,
        currency: "USD",
        ceiling_minor: b.unit_count * b.unit_price_minor,
        prompt: b.prompt,
        ...(b.title ? {title:b.title} : {}),
        contract_hash: digest(terms),
        terms,
        state: "AWAITING_BUYER_APPROVAL",
        version: 1,
        created_at: now(),
        deadline: new Date(ctx.now() + 30 * 60_000).toISOString(),
        retention_until: new Date(
          ctx.now() + 7 * 24 * 60 * 60_000,
        ).toISOString(),
      };
      return ctx.db.create(a.tenant, "batch", key, b, record);
    },
    batchInput,
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/v1/batches/:batch",
    ["operator"],
    ["operator", "buyer"],
    async (a, _b, p) => {
      const b = await batch(a.tenant, p.batch!);
      requireThat(
        a.role === "operator" || a.subject === b.buyer_id,
        "not_found",
        "Batch not found",
        404,
      );
      const { prompt, ...visible } = b;
      const recovered = (
        await ctx.db.list<Json>(a.tenant, "recovery", b.id)
      ).map((r) => ({
        unit_id: String(r.unit_id),
        artifact_id: String(r.artifact_id),
        recovered_at: String(r.recovered_at),
      }));
      return {
        ...visible,
        recovered,
        recovered_unit_ids: recovered.map((r) => r.unit_id),
      };
    },
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/v1/batches",
    ["operator"],
    ["operator"],
    async (a, _b, _p, _k, req) => {
      const q = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(25),
          after: uuid.optional(),
        })
        .parse(req.query);
      const rows = await ctx.db.tx(a.tenant, (db) =>
        db.query<{ body: Batch }>(
          "SELECT body FROM entities WHERE tenant_id=$1 AND kind='batch' AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT $3",
          [a.tenant, q.after ?? null, q.limit + 1],
        ),
      );
      const page = rows.rows.slice(0, q.limit).map((r) => {
        const { prompt, ...visible } = r.body;
        return visible;
      });
      return {
        items: page,
        next: rows.rows.length > q.limit ? page.at(-1)?.id : null,
      };
    },
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/v1/batches/:batch/consent",
    ["operator"],
    ["buyer"],
    async (a, raw, p) => {
      const input = raw as { contract_hash: string };
      return ctx.db.mutate<Batch>(
        a.tenant,
        "batch",
        uuid.parse(p.batch),
        async (b) => {
          requireThat(
            b.buyer_id === a.subject,
            "not_found",
            "Batch not found",
            404,
          );
          requireThat(
            input.contract_hash === b.contract_hash,
            "contract_changed",
            "Review the current contract",
          );
          if (b.consented_at) return b;
          requireThat(
            b.state === "AWAITING_BUYER_APPROVAL",
            "invalid_state",
            "Consent is not available",
          );
          return {
            ...b,
            consented_at: now(),
            state: "ACCEPTED",
            version: b.version + 1,
          };
        },
      );
    },
    z.strictObject({ contract_hash: z.string().length(64) }),
  );
  for (const [path, target] of [
    ["order", "orders"],
    ["authorize", "authorizations"],
  ] as const) {
    endpoint(
      app,
      ctx,
      "POST",
      "/v1/batches/:batch/paypal/" + path,
      ["operator"],
      ["buyer"],
      async (a, _raw, p, key) => {
        const b = await batch(a.tenant, p.batch!);
        requireThat(
          b.buyer_id === a.subject && b.consented_at,
          "consent_required",
          "Consenting buyer required",
          403,
        );
        requireThat(
          ["ACCEPTED", "AUTHORIZING", "AUTHORIZED"].includes(b.state),
          "batch_locked",
          "Batch no longer permits payment approval",
        );
        if (path === "authorize")
          await ctx.db.mutate<Batch>(a.tenant, "batch", b.id, async (old) => {
            requireThat(
              ["ACCEPTED", "AUTHORIZING", "AUTHORIZED"].includes(old.state),
              "batch_locked",
              "Batch is not authorizable",
            );
            return { ...old, state: "AUTHORIZING" };
          });
        const result = await ctx.call(
          "payments",
          "/internal/" + target,
          a.tenant,
          { batch_id: b.id },
          key,
        );
        if (result.state === "AUTHORIZED")
          await ctx.db.mutate<Batch>(
            a.tenant,
            "batch",
            b.id,
            async (old, q) => {
              if (old.state === "CANCEL_REQUESTED") {
                await ctx.db.enqueue(
                  q,
                  a.tenant,
                  "payments",
                  "/internal/cancellations",
                  { batch_id: b.id },
                );
                return old;
              }
              return { ...old, state: "AUTHORIZED", version: old.version + 1 };
            },
          );
        return result;
      },
    );
  }
  // Browser redirects carry no API bearer token. These public informational returns
  // deliberately perform no financial mutation and never reflect query identifiers.
  app.get(
    "/v1/paypal/return",
    {
      schema: {
        tags: ["commerce"],
        security: [],
        summary: "Informational PayPal return; no financial state change",
      },
    },
    async () => ({
      message:
        "PayPal approval returned. Payment is not yet confirmed. Continue in the authenticated buyer session to authorize the batch and inspect its status.",
      payment_confirmed: false,
    }),
  );
  app.get(
    "/v1/paypal/cancel",
    {
      schema: {
        tags: ["commerce"],
        security: [],
        summary:
          "Informational checkout cancellation; no financial state change",
      },
    },
    async () => ({
      message:
        "Checkout was cancelled. No payment or authorization release is inferred from this redirect. Check the batch in the authenticated buyer session.",
      payment_confirmed: false,
    }),
  );
  // Register a generation task against a unit. `/tasks` is the integration path for an
  // AI-video app that keeps its own provider: Runway or Replicate tasks are looked up with
  // the merchant's key; any other provider is "reported" with an output URL on a
  // pre-approved host. `/attempts` is the original name and stays for compatibility.
  const registerTask = async (
    a: { tenant: string },
    raw: unknown,
    p: Record<string, string | undefined>,
    key: string,
  ) => {
    const input = raw as {
      unit_id: string;
      provider_task_id?: string;
      source?: string;
      output_url?: string;
    };
    const b = await batch(a.tenant, p.batch!);
    requireThat(
      b.units.some((u) => u.id === input.unit_id) &&
        ["AUTHORIZED", "RUNNING"].includes(b.state) &&
        Date.parse(b.deadline) > ctx.now(),
      "batch_not_running",
      "Authorized current batch and known unit required",
    );
    const response = await ctx.call(
      "provider",
      "/internal/attempts",
      a.tenant,
      { batch_id: b.id, prompt: b.prompt, ...input },
      key,
    );
    await ctx.db.mutate<Batch>(a.tenant, "batch", b.id, async (old, q) => {
      requireThat(
        ["AUTHORIZED", "RUNNING"].includes(old.state),
        "state_changed",
        "Batch cannot accept attempt result",
      );
      // Watch the task and archive its output the moment it finishes, before the
      // provider deletes it (Replicate: one hour). Same transaction as the registration.
      if (
        process.env.AUTO_ARCHIVE_TASKS !== "false" &&
        !["FAILED", "CANCELLED"].includes(String(response.state))
      )
        await ctx.db.enqueue(q, a.tenant, "commerce", "/internal/tasks/archive", {
          batch_id: b.id,
          attempt_id: String(response.id),
        });
      return { ...old, state: "RUNNING", version: old.version + 1 };
    });
    return {
      id: response.id,
      state: response.state,
      unit_id: response.unit_id,
      source: response.source ?? "runway",
    };
  };
  const taskSchema = z.strictObject({
    unit_id: uuid,
    provider_task_id: z.string().min(1).max(100).optional(),
    source: z.enum(["runway", "replicate", "reported"]).optional(),
    output_url: z.string().regex(/^https:\/\/\S+$/).max(2000).optional(),
  });
  for (const path of ["/v1/batches/:batch/attempts", "/v1/batches/:batch/tasks"])
    endpoint(app, ctx, "POST", path, ["operator"], ["operator"], registerTask, taskSchema);
  endpoint(
    app,
    ctx,
    "POST",
    "/v1/batches/:batch/preserve",
    ["operator"],
    ["operator"],
    async (a, raw, p, key) => {
      const b = await batch(a.tenant, p.batch!);
      requireThat(
        ["RUNNING", "AUTHORIZED"].includes(b.state),
        "batch_locked",
        "Batch is locked",
      );
      return ctx.call(
        "delivery",
        "/internal/artifacts",
        a.tenant,
        {
          batch_id: b.id,
          attempt_id: (raw as { attempt_id: string }).attempt_id,
        },
        key,
      );
    },
    z.strictObject({ attempt_id: uuid }),
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/v1/batches/:batch/investigate",
    ["operator"],
    ["operator"],
    async (a, raw, p, key) => {
      const input = raw as { refresh_reason?: string };
      const b = await batch(a.tenant, p.batch!);
      requireThat(
        !["CLAIMED", "CANCEL_REQUESTED"].includes(b.state),
        "batch_locked",
        "Batch is locked",
      );
      const current = await snapshot(a.tenant, b);
      if (b.assessment_id && b.assessment_hash === current.hash) {
        const prior = await ctx.call(
          "investigation",
          "/internal/assessments/" + b.assessment_id,
          a.tenant,
        );
        if (prior.state === "VALID" && !input.refresh_reason) {
          await ctx.db.mutate<Batch>(a.tenant, "batch", b.id, async (old) => {
            requireThat(
              old.version === b.version,
              "state_changed",
              "Batch changed",
            );
            return {
              ...old,
              state: old.state === "CLOSED" ? "CLOSED" : "INVESTIGATED",
              version: old.version + 1,
            };
          });
          return prior;
        }
        if (["RESERVED", "RUNNING"].includes(String(prior.state))) return prior;
      }
      const assessment = await ctx.call(
        "investigation",
        "/internal/assessments",
        a.tenant,
        {
          batch_id: b.id,
          evidence: current.evidence,
          snapshot_hash: current.hash,
          ...(input.refresh_reason
            ? { refresh_reason: input.refresh_reason }
            : {}),
        },
        key,
      );
      await ctx.db.mutate<Batch>(a.tenant, "batch", b.id, async (old) => {
        requireThat(
          old.version === b.version,
          "state_changed",
          "Batch changed during investigation",
        );
        return {
          ...old,
          state:
            old.state === "CLOSED"
              ? "CLOSED"
              : assessment.state === "VALID"
                ? "INVESTIGATED"
                : "WAITING_FOR_AI",
          assessment_id: String(assessment.id),
          assessment_hash: current.hash,
          version: old.version + 1,
        };
      });
      return assessment;
    },
    z.strictObject({ refresh_reason: z.string().min(10).max(500).optional() }),
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/v1/batches/:batch/investigation",
    ["operator"],
    ["operator"],
    async (a, _raw, p) => {
      const b = await batch(a.tenant, p.batch!);
      requireThat(b.assessment_id, "not_found", "No assessment requested", 404);
      const record = await ctx.call(
        "investigation",
        "/internal/assessments/" + b.assessment_id,
        a.tenant,
      );
      // After settlement the records change because of the settlement itself (capture or
      // void). The reading the merchant approved on is then final, not out of date.
      const permit = b.proposal_id
        ? await ctx.db.get<Permit>(a.tenant, "permit", b.proposal_id)
        : undefined;
      const settled =
        ["CLAIMED", "CLOSED", "RECONCILING"].includes(b.state) &&
        permit?.assessment_id === b.assessment_id;
      return {
        ...record,
        current: settled || b.assessment_hash === (await snapshot(a.tenant, b)).hash,
        used_for_settlement: settled,
      };
    },
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/v1/batches/:batch/recover",
    ["operator"],
    ["operator"],
    async (a, raw, p, key) => {
      const b = await batch(a.tenant, p.batch!);
      const input = raw as { artifact_id: string; assessment_id: string };
      requireThat(
        b.assessment_id === input.assessment_id && b.state === "INVESTIGATED",
        "assessment_required",
        "Current reviewed recovery assessment required",
      );
      const current = await snapshot(a.tenant, b);
      requireThat(
        current.hash === b.assessment_hash &&
          current.artifacts.some((r) => r.id === input.artifact_id),
        "evidence_changed",
        "Evidence changed; investigate again",
      );
      const receipt = await ctx.call(
        "delivery",
        "/internal/artifacts/" + input.artifact_id + "/publish",
        a.tenant,
        { assessment_id: input.assessment_id },
        key,
      );
      const artifact = current.artifacts.find((r) => r.id === input.artifact_id)!;
      const unit = b.units.find((u) => u.id === artifact.unit_id);
      await ctx.db.mutate<Batch>(a.tenant, "batch", b.id, async (old, q) => {
        // One recovery record per artifact: the original was restored instead of re-rendered.
        const recoveryId = stableId({ artifact: input.artifact_id });
        if (!(await ctx.db.getIn(q, a.tenant, "recovery", recoveryId, true))) {
          await ctx.db.put(q, a.tenant, "recovery", recoveryId, {
            id: recoveryId,
            batch_id: b.id,
            unit_id: artifact.unit_id,
            artifact_id: input.artifact_id,
            assessment_id: input.assessment_id,
            unit_price_minor: unit?.price_minor ?? 0,
            rerender_cost_minor: Math.max(
              0,
              Math.min(100_000, Number(process.env.PROVIDER_RERENDER_COST_MINOR ?? 0) || 0),
            ),
            recovered_at: now(),
          });
          await emitEvent(ctx, q, a.tenant, "clip.recovered", recoveryId, {
            batch_id: b.id,
            unit_id: artifact.unit_id,
            artifact_id: input.artifact_id,
            rerendered: false,
          });
        }
        return {
          ...old,
          state: "RUNNING",
          assessment_id: undefined,
          assessment_hash: undefined,
          version: old.version + 1,
        };
      });
      return receipt;
    },
    z.strictObject({ artifact_id: uuid, assessment_id: uuid }),
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/v1/batches/:batch/closure-preview",
    ["operator"],
    ["operator"],
    async (a, _raw, p, key) => {
      const b = await batch(a.tenant, p.batch!);
      requireThat(
        b.state === "INVESTIGATED" && b.assessment_id,
        "assessment_required",
        "A valid current AI assessment is required",
      );
      const current = await snapshot(a.tenant, b);
      requireThat(
        current.hash === b.assessment_hash,
        "evidence_changed",
        "Evidence changed; investigate again",
      );
      const assessment = await ctx.call(
        "investigation",
        "/internal/assessments/" + b.assessment_id,
        a.tenant,
      );
      requireThat(
        assessment.state === "VALID" &&
          (assessment.provenance === "real" || ctx.fixture),
        "assessment_required",
        "Real valid AI assessment required",
      );
      const checks = (
        await ctx.call(
          "delivery",
          "/internal/batches/" + b.id + "/verify",
          a.tenant,
          {},
          "verify-" + id(),
        )
      ).receipts as Json[];
      const unique = new Map(
        checks
          .filter(
            (r) =>
              r.contract_hash === b.contract_hash && r.buyer_id === b.buyer_id,
          )
          .map((r) => [String(r.unit_id), r]),
      );
      const eligible = [...unique.keys()];
      const proposal: Permit = {
        id: id(),
        batch_id: b.id,
        buyer_id: b.buyer_id,
        contract_hash: b.contract_hash,
        batch_version: b.version + 1,
        unit_ids: eligible,
        amount_minor: eligibleAmount(b.units, eligible),
        currency: "USD",
        assessment_id: b.assessment_id,
        snapshot_hash: current.hash,
        verification_ids: [...unique.values()].map((r) => String(r.id)),
        action: eligible.length ? "CAPTURE" : "VOID",
        expires_at: new Date(ctx.now() + approvalWindowMs()).toISOString(),
        state: "PROPOSED",
        approval_actor: "",
      };
      await ctx.db.mutate<Batch>(a.tenant, "batch", b.id, async (old, q) => {
        requireThat(
          old.version === b.version,
          "state_changed",
          "Batch changed",
        );
        await ctx.db.put(q, a.tenant, "permit", proposal.id, proposal);
        return {
          ...old,
          state: "READY_FOR_REVIEW",
          proposal_id: proposal.id,
          version: old.version + 1,
        };
      });
      return { ...proposal, approval_digest: digest(proposal) };
    },
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/v1/batches/:batch/approve",
    ["operator"],
    ["operator"],
    async (a, raw, p) => {
      const b = await batch(a.tenant, p.batch!);
      const input = raw as { proposal_id: string; approval_digest: string };
      const permit = await ctx.db.get<Permit>(
        a.tenant,
        "permit",
        input.proposal_id,
      );
      requireThat(
        permit &&
          permit.batch_id === b.id &&
          permit.state === "PROPOSED" &&
          digest(permit) === input.approval_digest,
        "approval_stale",
        "Review current proposal",
      );
      requireThat(
        (await snapshot(a.tenant, b)).hash === permit.snapshot_hash,
        "evidence_changed",
        "Evidence changed",
      );
      await ctx.db.mutate<Batch>(a.tenant, "batch", b.id, async (old, q) => {
        requireThat(
          old.version === permit.batch_version &&
            old.proposal_id === permit.id &&
            Date.parse(permit.expires_at) > ctx.now(),
          "approval_stale",
          "Proposal is stale or expired",
        );
        await ctx.db.put(q, a.tenant, "permit", permit.id, {
          ...permit,
          state: "APPROVED",
          approval_actor: a.subject,
        });
        await ctx.db.enqueue(q, a.tenant, "payments", "/internal/settlements", {
          batch_id: b.id,
          permit_id: permit.id,
        });
        return { ...old, state: "SETTLEMENT_REQUESTED" };
      });
      return {
        batch_id: b.id,
        operation_id: permit.id,
        state: "SETTLEMENT_REQUESTED",
      };
    },
    z.strictObject({
      proposal_id: uuid,
      approval_digest: z.string().length(64),
    }),
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/v1/batches/:batch/cancel",
    ["operator"],
    ["operator", "buyer"],
    async (a, _raw, p) =>
      ctx.db.mutate<Batch>(
        a.tenant,
        "batch",
        uuid.parse(p.batch),
        async (b, q) => {
          requireThat(
            a.role === "operator" || a.subject === b.buyer_id,
            "not_found",
            "Batch not found",
            404,
          );
          requireThat(
            !["CLAIMED", "CLOSED"].includes(b.state),
            "reconciliation_required",
            "Claimed or completed payment requires explicit reconciliation/remedy",
          );
          if (b.proposal_id) {
            const permit = await ctx.db.getIn<Permit>(
              q,
              a.tenant,
              "permit",
              b.proposal_id,
              true,
            );
            if (permit)
              await ctx.db.put(q, a.tenant, "permit", permit.id, {
                ...permit,
                state: "REVOKED",
              });
          }
          await ctx.db.enqueue(
            q,
            a.tenant,
            "payments",
            "/internal/cancellations",
            { batch_id: b.id },
          );
          return { ...b, state: "CANCEL_REQUESTED", version: b.version + 1 };
        },
      ),
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/v1/batches/:batch/refunds",
    ["operator"],
    ["operator"],
    async (a, raw, p, key) => {
      const b = await batch(a.tenant, p.batch!);
      const input = raw as Json;
      const payload = { batch_id: b.id, ...input, review_actor: a.subject };
      const replay = await ctx.call(
        "payments",
        "/internal/refund-replay",
        a.tenant,
        { request_key: key, input: payload },
        key,
      );
      if (replay.operation) return replay.operation;
      if (!input.emergency)
        requireThat(
          input.assessment_id === b.assessment_id &&
            b.assessment_hash === (await snapshot(a.tenant, b)).hash,
          "assessment_stale",
          "Investigate current delivery/payment evidence before normal refund review",
        );
      return ctx.call("payments", "/internal/refunds", a.tenant, payload, key);
    },
    z.strictObject({
      unit_ids: z.array(uuid).min(1).max(10),
      reason: z.string().min(10).max(500),
      assessment_id: uuid.optional(),
      emergency: z.boolean().default(false),
      proposal_id: uuid.optional(),
      approval_digest: z.string().length(64).optional(),
    }),
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/v1/batches/:batch/refund-preview",
    ["operator"],
    ["operator"],
    async (a, raw, p, key) => {
      const b = await batch(a.tenant, p.batch!);
      const input = raw as { assessment_id: string };
      requireThat(
        input.assessment_id === b.assessment_id &&
          b.assessment_hash === (await snapshot(a.tenant, b)).hash,
        "assessment_stale",
        "Investigate current evidence before reviewing a refund",
      );
      return ctx.call(
        "payments",
        "/internal/refund-preview",
        a.tenant,
        { batch_id: b.id, ...(raw as Json), review_actor: a.subject },
        key,
      );
    },
    z.strictObject({
      unit_ids: z.array(uuid).min(1).max(10),
      reason: z.string().min(10).max(500),
      assessment_id: uuid,
    }),
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/v1/batches/:batch/review",
    ["operator"],
    ["operator"],
    async (a, _raw, p) => {
      const b = await batch(a.tenant, p.batch!);
      const [provider, delivery] = await Promise.all([
        ctx.call(
          "provider",
          "/internal/batches/" + b.id + "/attempts",
          a.tenant,
        ),
        ctx.call(
          "delivery",
          "/internal/batches/" + b.id + "/artifacts",
          a.tenant,
        ),
      ]);
      return {
        batch_id: b.id,
        state: b.state,
        attempts: (provider.attempts as Json[]).map(
          ({ id, unit_id, state, provider_task_id, created_at }) => ({
            id,
            unit_id,
            state,
            provider_task_id,
            created_at,
          }),
        ),
        artifacts: (delivery.artifacts as Json[]).map(
          ({ id, unit_id, state, published, retention_until }) => ({
            id,
            unit_id,
            state,
            published,
            retention_until,
          }),
        ),
      };
    },
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/v1/batches/:batch/outcomes",
    ["operator"],
    ["buyer", "operator"],
    async (a, _raw, p) => {
      const b = await batch(a.tenant, p.batch!);
      requireThat(
        a.role === "operator" || a.subject === b.buyer_id,
        "not_found",
        "Batch not found",
        404,
      );
      const artifacts = (
        await ctx.call(
          "delivery",
          "/internal/batches/" + b.id + "/artifacts",
          a.tenant,
        )
      ).artifacts as Json[];
      return {
        batch_id: b.id,
        state: b.state,
        artifacts: artifacts
          .filter((x) => x.published)
          .map((x) => ({
            ...x,
            content_path: "/v1/artifacts/" + x.id + "/content",
          })),
        delivery_token: await token(
          ctx.identity,
          "delivery",
          a.tenant,
          "buyer",
          b.buyer_id,
        ),
        ...(await ctx
          .call(
            "payments",
            "/internal/batches/" + b.id + "/operations",
            a.tenant,
          )
          .catch(() => ({ operations: [], payment_status_unavailable: true }))),
      };
    },
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/v1/operations/:operation/reconcile",
    ["operator"],
    ["operator"],
    async (a, _b, p, key) =>
      ctx.call(
        "payments",
        "/internal/operations/" + uuid.parse(p.operation) + "/reconcile",
        a.tenant,
        {},
        key,
      ),
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/internal/batches/:batch",
    ["payments", "provider", "delivery"],
    undefined,
    async (a, _b, p) => batch(a.tenant, p.batch!),
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/internal/permits/:permit",
    ["payments"],
    undefined,
    async (a, _b, p) => {
      const permit = await ctx.db.get(a.tenant, "permit", uuid.parse(p.permit));
      requireThat(permit, "not_found", "Permit not found", 404);
      return permit;
    },
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/permits/:permit/claim",
    ["payments"],
    undefined,
    async (a, raw, p) => {
      const input = raw as { operation_id: string };
      const permit = await ctx.db.get<Permit>(
        a.tenant,
        "permit",
        uuid.parse(p.permit),
      );
      requireThat(permit, "not_found", "Permit not found", 404);
      return ctx.db
        .mutate<Batch>(a.tenant, "batch", permit.batch_id, async (b, q) => {
          const current = await ctx.db.getIn<Permit>(
            q,
            a.tenant,
            "permit",
            permit.id,
            true,
          );
          requireThat(current, "not_found", "Permit not found", 404);
          if (current.state === "CLAIMED") {
            requireThat(
              current.operation_id === input.operation_id,
              "permit_claimed",
              "Permit belongs to another operation",
            );
            return b;
          }
          requireThat(
            current.state === "APPROVED" &&
              b.state === "SETTLEMENT_REQUESTED" &&
              b.version === permit.batch_version &&
              Date.parse(current.expires_at) > ctx.now(),
            "permit_invalid",
            "Permit was revoked, expired or changed",
          );
          await ctx.db.put(q, a.tenant, "permit", current.id, {
            ...current,
            state: "CLAIMED",
            operation_id: input.operation_id,
          });
          return { ...b, state: "CLAIMED", payment_id: input.operation_id };
        })
        .then(
          async () => await ctx.db.get<Permit>(a.tenant, "permit", permit.id),
        );
    },
    z.strictObject({ operation_id: uuid }),
  );
  // Outbox-driven watcher. A still-running task answers 503 so the outbox retries it with
  // backoff (about eight minutes in total); anything later is covered by investigation and
  // recovery. A fixed idempotency key makes repeated deliveries archive the file once.
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/tasks/archive",
    ["commerce"],
    undefined,
    async (a, raw) => {
      const input = raw as { batch_id: string; attempt_id: string };
      const b = await batch(a.tenant, input.batch_id);
      if (!["AUTHORIZED", "RUNNING"].includes(b.state))
        return { archived: false, reason: "batch_not_running" };
      const attempt = await ctx.call(
        "provider",
        "/internal/attempts/" + input.attempt_id,
        a.tenant,
      );
      requireThat(attempt.batch_id === b.id, "not_found", "Attempt not found", 404);
      const state = String(attempt.state);
      if (["FAILED", "CANCELLED"].includes(state))
        return { archived: false, reason: "task_" + state.toLowerCase() };
      if (state !== "SUCCEEDED")
        throw new Problem(503, "task_running", "Task has not finished yet");
      const artifact = await ctx.call(
        "delivery",
        "/internal/artifacts",
        a.tenant,
        { batch_id: b.id, attempt_id: input.attempt_id },
        "archive-" + input.attempt_id,
      );
      return { archived: artifact.state === "STORED", artifact_id: artifact.id, state: artifact.state };
    },
    z.strictObject({ batch_id: uuid, attempt_id: uuid }),
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/payment-outcomes",
    ["payments"],
    undefined,
    async (a, raw) => {
      const b = raw as { batch_id: string; operation_id: string };
      const op = await ctx.call(
        "payments",
        "/internal/operations/" + b.operation_id,
        a.tenant,
      );
      requireThat(
        op.batch_id === b.batch_id && op.state === "CONFIRMED",
        "payment_unconfirmed",
        "Confirmed payment read-back required",
      );
      const all = (
        await ctx.call(
          "payments",
          "/internal/batches/" + b.batch_id + "/operations",
          a.tenant,
        )
      ).operations as Json[];
      const unsettled = all.some(
        (o) => !["CONFIRMED", "FAILED", "CANCELED"].includes(String(o.state)),
      );
      return ctx.db.mutate<Batch>(
        a.tenant,
        "batch",
        b.batch_id,
        async (old, q) => {
          const state = unsettled ? "RECONCILING" : "CLOSED";
          if (state === "CLOSED" && old.state !== "CLOSED") {
            const capture = op.kind === "CAPTURE";
            const permit = old.proposal_id
              ? await ctx.db.getIn<Permit>(q, a.tenant, "permit", old.proposal_id)
              : undefined;
            await emitEvent(
              ctx,
              q,
              a.tenant,
              capture ? "batch.settled" : "batch.voided",
              b.operation_id,
              {
                batch_id: b.batch_id,
                operation_id: b.operation_id,
                action: String(op.kind),
                amount_minor: capture ? Number(op.amount_minor ?? 0) : 0,
                currency: String(op.currency ?? "USD"),
                clips_charged: capture ? (permit?.unit_ids.length ?? 0) : 0,
                clips_total: old.units.length,
                statement_path: "/v1/batches/" + b.batch_id + "/statement",
              },
            );
          }
          return {
            ...old,
            state,
            payment_id: b.operation_id,
            version: old.version + 1,
          };
        },
      );
    },
    z.strictObject({ batch_id: uuid, operation_id: uuid }),
  );
}
