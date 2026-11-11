import type { FastifyInstance } from "fastify";
import type { Context } from "../core/context.js";
import type { Sql } from "../core/database.js";
import { endpoint } from "../core/http.js";
import { requireThat } from "../core/errors.js";
import {
  digest,
  stableId,
  now,
  uuid,
  type Json,
  type Operation,
} from "../domain/contracts.js";
import { z } from "zod";

async function basis(q: Sql, tenant: string, batchId: string) {
  const account = await q.query(
    "SELECT captured,refunded,reserved_refund FROM money_accounts WHERE tenant_id=$1 AND batch_id=$2",
    [tenant, batchId],
  );
  const units = await q.query(
    "SELECT unit_id,amount_minor FROM unit_settlements WHERE tenant_id=$1 AND batch_id=$2 ORDER BY unit_id",
    [tenant, batchId],
  );
  const ops = await q.query<{ body: Operation }>(
    "SELECT body FROM entities WHERE tenant_id=$1 AND kind='operation' AND body->>'batch_id'=$2 ORDER BY id",
    [tenant, batchId],
  );
  return {
    account: account.rows[0],
    units: units.rows,
    operations: ops.rows.map(({ body: o }) => ({
      id: o.id,
      kind: o.kind,
      state: o.state,
      amount_minor: o.amount_minor,
      currency: o.currency ?? "USD",
      provider_id: o.provider_id,
    })),
  };
}
export async function verifyRefundApproval(
  ctx: Context,
  q: Sql,
  tenant: string,
  input: Json,
) {
  if (input.emergency) return; // Existing explicitly audited safe fund-release authority.
  requireThat(
    input.proposal_id && input.approval_digest,
    "refund_review_required",
    "Review the exact refund before approval",
  );
  const proposal = await ctx.db.getIn<Json>(
    q,
    tenant,
    "refund_proposal",
    String(input.proposal_id),
    true,
  );
  requireThat(
    proposal &&
      proposal.state === "PROPOSED" &&
      Date.parse(String(proposal.expires_at)) > ctx.now() &&
      digest(proposal) === input.approval_digest,
    "approval_stale",
    "Refund review expired or changed",
  );
  requireThat(
    proposal.batch_id === input.batch_id &&
      proposal.reason === input.reason &&
      proposal.review_actor === input.review_actor &&
      proposal.assessment_id === input.assessment_id &&
      digest(proposal.unit_ids) === digest(input.unit_ids) &&
      proposal.basis_hash ===
        digest(await basis(q, tenant, String(input.batch_id))),
    "evidence_changed",
    "Refund evidence changed; review again",
  );
  await ctx.db.put(q, tenant, "refund_proposal", String(proposal.id), {
    ...proposal,
    state: "APPROVED",
  });
}
export function refundReviewRoutes(app: FastifyInstance, ctx: Context) {
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/refund-replay",
    ["commerce"],
    undefined,
    async (a, raw) => {
      const input = raw as { request_key: string; input: Json };
      const prior = await ctx.db.get<Json>(
        a.tenant,
        "refund_request",
        stableId({ tenant: a.tenant, key: input.request_key }),
      );
      if (!prior) return { operation: null };
      requireThat(
        prior.request_body_hash === digest(input.input),
        "idempotency_conflict",
        "Refund key has different input",
      );
      return {
        operation: await ctx.db.get(a.tenant, "operation", String(prior.id)),
      };
    },
    z.strictObject({
      request_key: z.string().min(8).max(128),
      input: z.record(z.string(), z.unknown()),
    }),
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/internal/batches/:batch/financials",
    ["commerce"],
    undefined,
    async (a, _b, p) => {
      const order = await ctx.db.get(a.tenant, "order", uuid.parse(p.batch));
      const auth = await ctx.db.get(a.tenant, "authorization", p.batch!);
      const rows = await ctx.db.tx(a.tenant, (q) =>
        q.query<{ body: Operation; created_at: string; updated_at: string }>(
          "SELECT body,created_at,updated_at FROM entities WHERE kind='operation' AND body->>'batch_id'=$1 ORDER BY created_at,id",
          [p.batch],
        ),
      );
      const ops = rows.rows.map((r) => ({
        ...r.body,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));
      const refundable = await ctx.db.tx(a.tenant, (q) =>
        q.query<{ unit_id: string; amount_minor: number }>(
          `SELECT u.unit_id,u.amount_minor FROM unit_settlements u
         JOIN entities o ON o.tenant_id=u.tenant_id AND o.kind='operation' AND o.id=u.operation_id
         WHERE u.tenant_id=$1 AND u.batch_id=$2 AND o.body->>'state'='CONFIRMED'
         AND NOT EXISTS (SELECT 1 FROM entities r WHERE r.tenant_id=u.tenant_id AND r.kind='unit_remedy' AND r.id=u.unit_id)
         ORDER BY u.unit_id`,
          [a.tenant, p.batch],
        ),
      );
      return {
        environment: ctx.fixture ? "fixture" : "sandbox",
        observed_at: now(),
        order: order
          ? {
              id: order.id,
              provider_id: order.provider_id,
              state: order.state,
              approval_url: order.approval_url,
            }
          : null,
        authorization: auth
          ? {
              id: auth.id,
              provider_id: auth.provider_id,
              state: auth.state,
              amount_minor: auth.amount_minor,
              confirmed_at: auth.confirmed_at,
              expires_at: auth.expires_at,
            }
          : null,
        refundable_units: refundable.rows.map((u) => ({
          unit_id: u.unit_id,
          amount_minor: Number(u.amount_minor),
        })),
        operations: ops.map(
          ({
            id,
            kind,
            state,
            amount_minor,
            currency,
            provider_id,
            capture_id,
            error_code,
            created_at,
            updated_at,
          }) => ({
            id,
            kind,
            state,
            amount_minor,
            currency,
            provider_id,
            capture_id,
            error_code,
            created_at,
            updated_at,
          }),
        ),
      };
    },
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/refund-preview",
    ["commerce"],
    undefined,
    async (a, raw, _p, key) => {
      const input = raw as {
        batch_id: string;
        unit_ids: string[];
        reason: string;
        assessment_id: string;
        review_actor: string;
      };
      return ctx.db.tx(a.tenant, async (q) => {
        await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          a.tenant + input.batch_id,
        ]);
        const proposalId = stableId({
          tenant: a.tenant,
          key,
          kind: "refund-preview",
        });
        const prior = await ctx.db.getIn<Json>(
          q,
          a.tenant,
          "refund_proposal",
          proposalId,
        );
        if (prior) {
          requireThat(
            prior.input_hash === digest(input),
            "idempotency_conflict",
            "Preview input changed",
          );
          return { ...prior, approval_digest: digest(prior) };
        }
        const data = await basis(q, a.tenant, input.batch_id);
        const capture = data.operations.find(
          (o) => o.kind === "CAPTURE" && o.state === "CONFIRMED",
        );
        requireThat(
          capture?.provider_id,
          "capture_required",
          "Confirmed original capture required",
        );
        const units = data.units.filter((u) =>
          input.unit_ids.includes(String(u.unit_id)),
        );
        requireThat(
          units.length === input.unit_ids.length &&
            new Set(input.unit_ids).size === input.unit_ids.length,
          "refund_units_invalid",
          "Choose captured units",
        );
        for (const unit of input.unit_ids)
          requireThat(
            !(await ctx.db.getIn(q, a.tenant, "unit_remedy", unit)),
            "remedy_exists",
            "A remedy already exists for this unit",
          );
        const proposal = {
          id: proposalId,
          ...input,
          amount_minor: units.reduce((n, u) => n + Number(u.amount_minor), 0),
          currency: capture.currency ?? "USD",
          capture_id: capture.provider_id,
          basis_hash: digest(data),
          input_hash: digest(input),
          expires_at: new Date(ctx.now() + 45000).toISOString(),
          state: "PROPOSED",
        };
        await ctx.db.put(q, a.tenant, "refund_proposal", proposalId, proposal);
        return { ...proposal, approval_digest: digest(proposal) };
      });
    },
    z.strictObject({
      batch_id: uuid,
      unit_ids: z.array(uuid).min(1).max(10),
      reason: z.string().min(10).max(500),
      assessment_id: uuid,
      review_actor: uuid,
    }),
  );
}
