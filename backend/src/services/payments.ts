import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Context } from "../core/context.js";
import { endpoint, safeRecord } from "../core/http.js";
import { requireThat } from "../core/errors.js";
import { refundReviewRoutes, verifyRefundApproval } from "./refund-review.js";
import {
  id,
  uuid,
  now,
  digest,
  stableId,
  type Json,
  type Permit,
  type Operation,
} from "../domain/contracts.js";
import {
  verifyMoney,
  refundReferencesCapture,
} from "../adapters/paypal.js";
import { sameMoney, isCurrency, formatMoney, type Currency } from "../domain/money.js";
import type { PayOptions } from "../core/context.js";
import { disputeRoutes, openDispute } from "./disputes.js";
import { merchantRoutes, merchantFor, tenantForMerchant } from "./merchants.js";
import {
  deliveryStatement,
  statementNote,
  signStatement,
  type Statement,
} from "../domain/statement.js";
function amountMatches(r: Json, amount: number, code: Currency = "USD") {
  return sameMoney(r.amount as Json | undefined, amount, code);
}
const currencyOf = (r: Json | undefined): Currency =>
  isCurrency(r?.currency) ? r.currency : "USD";
// Which PayPal account and currency a stored record's money belongs to. Records created
// before multi-merchant support carry neither and mean the platform account in USD.
export function payOptions(ctx: Context, r: Json | undefined): PayOptions & { merchantId: string; currency: Currency } {
  return {
    currency: currencyOf(r),
    merchantId: typeof r?.merchant_id === "string" ? r.merchant_id : ctx.merchantId,
  };
}
function authorizationFrom(order: Json) {
  const units = order.purchase_units as Json[] | undefined;
  const payments = units?.[0]?.payments as Json | undefined;
  return (payments?.authorizations as Json[] | undefined)?.[0];
}
export function paymentRoutes(app: FastifyInstance, ctx: Context) {
  refundReviewRoutes(app, ctx);
  disputeRoutes(app, ctx);
  merchantRoutes(app, ctx);
  const ensure = () => {
    requireThat(
      ctx.paypal?.available && ctx.merchantId,
      "integration_unavailable",
      "Configured PayPal Sandbox merchant is required",
      503,
    );
    return ctx.paypal;
  };
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/dispatch-control",
    ["commerce"],
    undefined,
    async (a, raw) => {
      const input = raw as { paused: boolean; reason: string };
      const key = stableId({ tenant: a.tenant, control: "payments" });
      return ctx.db.tx(a.tenant, async (q) => {
        await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          a.tenant + "dispatch-control",
        ]);
        const value = { id: key, ...input, updated_at: now() };
        await ctx.db.put(q, a.tenant, "dispatch_control", key, value);
        return value;
      });
    },
    z.strictObject({
      paused: z.boolean(),
      reason: z.string().min(10).max(500),
    }),
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/orders",
    ["commerce"],
    undefined,
    async (a, raw, _p, key) => {
      const b = raw as { batch_id: string };
      const paypal = ensure();
      const batch = await ctx.call(
        "commerce",
        "/internal/batches/" + b.batch_id,
        a.tenant,
      );
      requireThat(
        batch.consented_at,
        "consent_required",
        "Buyer must accept the contract first",
      );
      const merchant = await merchantFor(ctx, a.tenant);
      const order = await ctx.db.create(a.tenant, "order", b.batch_id, b, {
        id: b.batch_id,
        batch_id: b.batch_id,
        state: "RESERVED",
        amount_minor: batch.ceiling_minor,
        currency: currencyOf(batch),
        merchant_id: merchant,
      });
      if (order.state !== "RESERVED") return order;
      await ctx.db.mutate(a.tenant, "order", b.batch_id, async (o) => {
        requireThat(
          o.state === "RESERVED",
          "already_dispatched",
          "Order creation is already in progress",
        );
        return { ...o, state: "DISPATCHING" };
      });
      try {
        const resource = await paypal.createOrder(
          b.batch_id,
          Number(batch.ceiling_minor),
          b.batch_id,
          payOptions(ctx, order),
        );
        const links = resource.links as Json[] | undefined;
        return ctx.db.mutate(a.tenant, "order", b.batch_id, async (o) => ({
          ...o,
          state: "CREATED",
          provider_id: resource.id,
          approval_url: links?.find(
            (l) => l.rel === "payer-action" || l.rel === "approve",
          )?.href,
        }));
      } catch {
        return ctx.db.mutate(a.tenant, "order", b.batch_id, async (o) => ({
          ...o,
          state: "UNKNOWN",
        }));
      }
    },
    z.strictObject({ batch_id: uuid }),
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/internal/batches/:batch/order",
    ["commerce"],
    undefined,
    async (a, _b, p) => {
      const order = await ctx.db.get(a.tenant, "order", uuid.parse(p.batch));
      requireThat(order, "not_found", "Order not found", 404);
      return order;
    },
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/authorizations",
    ["commerce"],
    undefined,
    async (a, raw) => {
      const b = raw as { batch_id: string };
      const paypal = ensure();
      const batch = await ctx.call(
        "commerce",
        "/internal/batches/" + b.batch_id,
        a.tenant,
      );
      const order = await ctx.db.get<Json>(a.tenant, "order", b.batch_id);
      requireThat(
        order?.provider_id,
        "order_required",
        "Known PayPal order required",
      );
      const o = payOptions(ctx, order);
      requireThat(
        o.currency === currencyOf(batch),
        "order_mismatch",
        "Order currency does not match contract",
      );
      const resource = await paypal.getOrder(String(order.provider_id), o);
      const units = resource.purchase_units as Json[] | undefined;
      const unit = units?.[0];
      requireThat(
        units?.length === 1 &&
          unit?.reference_id === b.batch_id &&
          verifyMoney(unit, Number(batch.ceiling_minor), o.merchantId, o.currency),
        "order_mismatch",
        "PayPal order does not match contract",
      );
      const old = await ctx.db.get<Json>(a.tenant, "authorization", b.batch_id);
      if (old) return old;
      requireThat(
        resource.status === "APPROVED",
        "approval_required",
        "Buyer approval is required",
      );
      const record = await ctx.db.create(
        a.tenant,
        "authorization",
        b.batch_id,
        b,
        {
          id: b.batch_id,
          batch_id: b.batch_id,
          state: "RESERVED",
          order_id: order.provider_id,
          amount_minor: batch.ceiling_minor,
          currency: o.currency,
          merchant_id: o.merchantId,
        },
      );
      await ctx.db.mutate(a.tenant, "authorization", b.batch_id, async (r) => {
        requireThat(
          r.state === "RESERVED",
          "already_dispatched",
          "Authorization already dispatched",
        );
        return { ...r, state: "DISPATCHING" };
      });
      try {
        const response = await paypal.authorizeOrder(
          String(order.provider_id),
          b.batch_id,
          o,
        );
        const auth = authorizationFrom(response);
        requireThat(
          auth?.id && amountMatches(auth, Number(batch.ceiling_minor), o.currency),
          "authorization_mismatch",
          "Invalid authorization resource",
        );
        const checked = await paypal.getAuthorization(String(auth.id), o);
        requireThat(
          checked.status === "CREATED" &&
            amountMatches(checked, Number(batch.ceiling_minor), o.currency),
          "authorization_pending",
          "Authorization is not confirmed",
        );
        return ctx.db.mutate(
          a.tenant,
          "authorization",
          b.batch_id,
          async (r) => ({
            ...r,
            state: "AUTHORIZED",
            provider_id: auth.id,
            order_id: order.provider_id,
            expires_at: checked.expiration_time,
            confirmed_at: now(),
          }),
        );
      } catch {
        return ctx.db.mutate(
          a.tenant,
          "authorization",
          b.batch_id,
          async (r) => ({ ...r, state: "UNKNOWN" }),
        );
      }
    },
    z.strictObject({ batch_id: uuid }),
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/internal/batches/:batch/authorization",
    ["commerce", "provider"],
    undefined,
    async (a, _b, p) => {
      const auth = await ctx.db.get(
        a.tenant,
        "authorization",
        uuid.parse(p.batch),
      );
      requireThat(auth, "not_found", "Authorization not found", 404);
      return auth;
    },
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/cancellations",
    ["commerce"],
    undefined,
    async (a, raw) => {
      const b = raw as { batch_id: string };
      ensure();
      const key = stableId({ batch: b.batch_id, action: "safe-cancel" });
      const auth = await ctx.db.get<Json>(
        a.tenant,
        "authorization",
        b.batch_id,
      );
      if (!auth) return { state: "NO_AUTHORIZATION_RECORDED" };
      requireThat(
        auth.state === "AUTHORIZED" && auth.provider_id,
        "authorization_uncertain",
        "Authorization requires reconciliation before release",
      );
      return ctx.db.tx(a.tenant, async (q) => {
        await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          a.tenant + b.batch_id,
        ]);
        const prior = await ctx.db.getIn<Operation>(
          q,
          a.tenant,
          "operation",
          key,
          true,
        );
        if (prior) return prior;
        const settlement = await ctx.db.getIn<Json>(
          q,
          a.tenant,
          "final_settlement",
          b.batch_id,
          true,
        );
        if (settlement) {
          const active = await ctx.db.getIn<Operation>(
            q,
            a.tenant,
            "operation",
            String(settlement.operation_id),
            true,
          );
          requireThat(
            active?.state === "RESERVED",
            "settlement_in_progress",
            "Dispatched or confirmed settlement requires reconciliation/refund",
          );
          await ctx.db.put(q, a.tenant, "operation", active.id, {
            ...active,
            state: "CANCELED",
          });
        }
        const op: Operation = {
          id: key,
          batch_id: b.batch_id,
          kind: "VOID",
          state: "RESERVED",
          amount_minor: 0,
          ...payOptionsRecord(ctx, auth),
          request_key: key,
          authorization_id: auth.provider_id,
          emergency: true,
        };
        await ctx.db.put(q, a.tenant, "operation", key, op);
        await ctx.db.put(q, a.tenant, "final_settlement", b.batch_id, {
          id: b.batch_id,
          operation_id: key,
        });
        await ctx.db.enqueue(
          q,
          a.tenant,
          "payments",
          "/internal/operations/" + key + "/execute",
          {},
        );
        return op;
      });
    },
    z.strictObject({ batch_id: uuid }),
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/settlements",
    ["commerce"],
    undefined,
    async (a, raw) => {
      const b = raw as { batch_id: string; permit_id: string };
      const paypal = ensure();
      const existing = await ctx.db.get<Operation>(
        a.tenant,
        "operation",
        b.permit_id,
      );
      if (existing) return existing;
      const permit = (await ctx.call(
        "commerce",
        "/internal/permits/" + b.permit_id + "/claim",
        a.tenant,
        { operation_id: b.permit_id },
        "claim-" + b.permit_id,
      )) as Permit;
      requireThat(
        permit.batch_id === b.batch_id &&
          Date.parse(permit.expires_at) > ctx.now(),
        "permit_invalid",
        "Permit is not valid for this operation",
      );
      const assessment = await ctx.call(
        "investigation",
        "/internal/assessments/" + permit.assessment_id,
        a.tenant,
      );
      requireThat(
        assessment.state === "VALID" &&
          assessment.batch_id === b.batch_id &&
          assessment.snapshot_hash === permit.snapshot_hash &&
          (assessment.provenance === "real" || ctx.fixture),
        "assessment_required",
        "Matching real AI assessment required",
      );
      const batch = await ctx.call(
        "commerce",
        "/internal/batches/" + b.batch_id,
        a.tenant,
      );
      const unitPrices = new Map(
        (batch.units as { id: string; price_minor: number }[]).map((u) => [
          u.id,
          u.price_minor,
        ]),
      );
      const receipts = await Promise.all(
        permit.verification_ids.map((v) =>
          ctx.call("delivery", "/internal/verifications/" + v, a.tenant),
        ),
      );
      requireThat(
        receipts.length === permit.unit_ids.length &&
          new Set(permit.unit_ids).size === permit.unit_ids.length &&
          receipts.every(
            (r) =>
              r.batch_id === b.batch_id &&
              r.buyer_id === permit.buyer_id &&
              r.contract_hash === permit.contract_hash &&
              r.outcome === "VERIFIED" &&
              permit.unit_ids.includes(String(r.unit_id)) &&
              Date.parse(String(r.valid_until)) > ctx.now(),
          ),
        "delivery_required",
        "Current purchaser delivery evidence required",
      );
      const total = permit.unit_ids.reduce(
        (sum, u) => sum + (unitPrices.get(u) ?? NaN),
        0,
      );
      requireThat(
        total === permit.amount_minor && total <= Number(batch.ceiling_minor),
        "amount_mismatch",
        "Permit amount does not match units",
      );
      const auth = await ctx.db.get<Json>(
        a.tenant,
        "authorization",
        b.batch_id,
      );
      requireThat(
        auth?.provider_id && auth.state === "AUTHORIZED",
        "authorization_required",
        "Confirmed authorization required",
      );
      const o = payOptions(ctx, auth);
      requireThat(
        o.currency === currencyOf(batch),
        "authorization_invalid",
        "Authorization currency does not match contract",
      );
      const current = await paypal.getAuthorization(String(auth.provider_id), o);
      requireThat(
        current.status === "CREATED" &&
          amountMatches(current, Number(batch.ceiling_minor), o.currency),
        "authorization_invalid",
        "Authorization is no longer available",
      );
      const statement = deliveryStatement({
        batch_id: b.batch_id,
        permit_id: b.permit_id,
        contract_hash: permit.contract_hash,
        assessment_id: permit.assessment_id,
        ceiling_minor: Number(batch.ceiling_minor),
        currency: o.currency,
        units: batch.units as { id: string; price_minor: number }[],
        billed: permit.unit_ids,
        receipts,
      });
      const op: Operation = {
        id: b.permit_id,
        batch_id: b.batch_id,
        kind: permit.action,
        state: "RESERVED",
        amount_minor: total,
        currency: o.currency,
        merchant_id: o.merchantId,
        request_key: b.permit_id,
        permit_id: b.permit_id,
        authorization_id: auth.provider_id,
        order_id: auth.order_id,
        statement,
        statement_digest: digest(statement),
      };
      await ctx.db.tx(a.tenant, async (q) => {
        await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          a.tenant + b.batch_id,
        ]);
        requireThat(
          !(await ctx.db.getIn(
            q,
            a.tenant,
            "final_settlement",
            b.batch_id,
            true,
          )),
          "settlement_exists",
          "A final settlement is already reserved",
        );
        await ctx.db.put(q, a.tenant, "final_settlement", b.batch_id, {
          id: b.batch_id,
          operation_id: op.id,
        });
        await ctx.db.put(q, a.tenant, "operation", op.id, op);
        await q.query(
          "INSERT INTO money_accounts(tenant_id,batch_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [a.tenant, b.batch_id],
        );
        for (const unit of permit.unit_ids)
          await q.query(
            "INSERT INTO unit_settlements(tenant_id,unit_id,batch_id,operation_id,amount_minor) VALUES($1,$2,$3,$4,$5)",
            [a.tenant, unit, b.batch_id, op.id, unitPrices.get(unit)],
          );
        await ctx.db.enqueue(
          q,
          a.tenant,
          "payments",
          "/internal/operations/" + op.id + "/execute",
          {},
        );
      });
      return op;
    },
    z.strictObject({ batch_id: uuid, permit_id: uuid }),
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/operations/:operation/execute",
    ["payments"],
    undefined,
    async (a, _b, p) => {
      const paypal = ensure();
      const key = uuid.parse(p.operation);
      const op = await ctx.db.get<Operation>(a.tenant, "operation", key);
      requireThat(op, "not_found", "Operation not found", 404);
      if (op.state !== "RESERVED") return op;
      if (op.permit_id) {
        const permit = await ctx.call(
          "commerce",
          "/internal/permits/" + op.permit_id,
          a.tenant,
        );
        requireThat(
          permit.state === "CLAIMED" &&
            permit.operation_id === key &&
            Date.parse(String(permit.expires_at)) > ctx.now(),
          "permit_expired",
          "Permit cannot authorize dispatch",
        );
      }
      await ctx.db.mutate<Operation>(
        a.tenant,
        "operation",
        key,
        async (old, q) => {
          requireThat(
            old.state === "RESERVED",
            "dispatch_conflict",
            "Operation has already been dispatched",
          );
          await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            a.tenant + "dispatch-control",
          ]);
          const control = await ctx.db.getIn<Json>(
            q,
            a.tenant,
            "dispatch_control",
            stableId({ tenant: a.tenant, control: "payments" }),
          );
          requireThat(
            !control?.paused || old.kind === "VOID" || old.emergency === true,
            "dispatch_paused",
            "New capture and normal refund dispatch is paused",
            503,
          );
          return { ...old, state: "DISPATCHING" };
        },
      );
      const o = payOptions(ctx, op);
      try {
        let response: Json;
        if (op.kind === "CAPTURE")
          response = await paypal.capture(
            String(op.authorization_id),
            op.amount_minor,
            op.request_key,
            op.statement
              ? {
                  invoice_id: op.id,
                  note_to_payer: statementNote(
                    op.statement as Statement,
                    String(op.statement_digest),
                  ),
                }
              : undefined,
            o,
          );
        else if (op.kind === "REFUND")
          response = await paypal.refund(
            String(op.capture_id),
            op.amount_minor,
            op.request_key,
            o,
            {
              invoice_id: op.id,
              note_to_payer:
                "Refund of " + formatMoney(op.amount_minor, o.currency) + " against your Assay capture " + String(op.capture_id) + ".",
            },
          );
        else
          response = await paypal.void(
            String(op.authorization_id),
            op.request_key,
            o,
          );
        await ctx.db.mutate<Operation>(
          a.tenant,
          "operation",
          key,
          async (old) =>
            old.state === "CONFIRMED"
              ? old
              : {
                  ...old,
                  state: "PENDING",
                  ...(!old.provider_id && typeof response.id === "string"
                    ? { provider_id: response.id }
                    : {}),
                },
        );
        return reconcile(ctx, a.tenant, key);
      } catch {
        return ctx.db.mutate<Operation>(
          a.tenant,
          "operation",
          key,
          async (old) =>
            old.state === "CONFIRMED"
              ? old
              : {
                  ...old,
                  state: "UNKNOWN",
                  error_code: "external_outcome_uncertain",
                },
        );
      }
    },
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/operations/:operation/reconcile",
    ["commerce", "payments"],
    undefined,
    async (a, _b, p) => reconcile(ctx, a.tenant, uuid.parse(p.operation)),
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/internal/operations/:operation",
    ["commerce"],
    undefined,
    async (a, _b, p) => {
      const op = await ctx.db.get(
        a.tenant,
        "operation",
        uuid.parse(p.operation),
      );
      requireThat(op, "not_found", "Operation not found", 404);
      return op;
    },
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/internal/batches/:batch/operations",
    ["commerce"],
    undefined,
    async (a, _b, p) => ({
      operations: await ctx.db.list(a.tenant, "operation", uuid.parse(p.batch)),
    }),
  );
  // A signed statement exists only after PayPal read-back confirms the final operation.
  endpoint(
    app,
    ctx,
    "GET",
    "/internal/batches/:batch/statement",
    ["commerce"],
    undefined,
    async (a, _b, p) => {
      const ops = await ctx.db.list<Operation>(
        a.tenant,
        "operation",
        uuid.parse(p.batch),
      );
      const final = ops.find(
        (o) => (o.kind === "CAPTURE" || o.kind === "VOID") && o.statement,
      );
      requireThat(final, "not_found", "No settlement statement yet", 404);
      const refunds = ops
        .filter((o) => o.kind === "REFUND" && o.state === "CONFIRMED")
        .reduce((sum, o) => sum + o.amount_minor, 0);
      if (final.state !== "CONFIRMED")
        return {
          state: final.state,
          signed: false,
          note: "Settlement is not confirmed by PayPal yet. Pending or unknown is not paid.",
          statement: final.statement,
        };
      const settled = {
        ...(final.statement as Statement),
        settlement: {
          kind: final.kind,
          state: "CONFIRMED",
          paypal_reference: final.provider_id ?? final.authorization_id,
          confirmed_refunds_minor: refunds,
        },
      };
      return {
        state: "CONFIRMED",
        signed: true,
        statement: settled,
        statement_digest: digest(settled),
        jws: await signStatement(ctx.identity, settled),
      };
    },
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/refunds",
    ["commerce"],
    undefined,
    async (a, raw, _p, key) => {
      const b = raw as {
        batch_id: string;
        unit_ids: string[];
        reason: string;
        assessment_id?: string;
        emergency: boolean;
        proposal_id?: string;
        approval_digest?: string;
        review_actor?: string;
      };
      ensure();
      if (!b.emergency) {
        requireThat(
          b.assessment_id,
          "assessment_required",
          "AI assessment required",
        );
        const assessment = await ctx.call(
          "investigation",
          "/internal/assessments/" + b.assessment_id,
          a.tenant,
        );
        requireThat(
          assessment.state === "VALID" &&
            assessment.batch_id === b.batch_id &&
            (assessment.provenance === "real" || ctx.fixture),
          "assessment_required",
          "Valid AI assessment required",
        );
      }
      const requestId = stableId({ tenant: a.tenant, key });
      const old = await ctx.db.get<Operation>(
        a.tenant,
        "refund_request",
        requestId,
      );
      if (old) {
        requireThat(
          old.request_body_hash === digest(b),
          "idempotency_conflict",
          "Refund key has different input",
        );
        return await ctx.db.get(a.tenant, "operation", old.id);
      }
      const ops = await ctx.db.list<Operation>(
        a.tenant,
        "operation",
        b.batch_id,
      );
      const capture = ops.find(
        (o) => o.kind === "CAPTURE" && o.state === "CONFIRMED",
      );
      requireThat(
        capture?.provider_id,
        "capture_required",
        "Confirmed original capture required",
      );
      const op: Operation = {
        id: id(),
        batch_id: b.batch_id,
        kind: "REFUND",
        state: "RESERVED",
        amount_minor: 0,
        ...payOptionsRecord(ctx, capture),
        request_key: id(),
        capture_id: capture.provider_id,
        reason: b.reason,
        emergency: b.emergency,
        review_actor: b.review_actor,
        request_body_hash: digest(b),
      };
      return ctx.db.tx(a.tenant, async (q) => {
        await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          a.tenant + b.batch_id,
        ]);
        const prior = await ctx.db.getIn<Operation>(
          q,
          a.tenant,
          "refund_request",
          requestId,
        );
        if (prior) {
          requireThat(
            prior.request_body_hash === digest(b),
            "idempotency_conflict",
            "Refund key has different input",
          );
          return (await ctx.db.getIn<Operation>(
            q,
            a.tenant,
            "operation",
            prior.id,
          ))!;
        }
        // A refund while PayPal holds an open dispute could pay the buyer twice.
        const dispute = await openDispute(ctx, q, a.tenant, b.batch_id);
        requireThat(
          !dispute,
          "dispute_open",
          "A PayPal dispute is open on this capture. Respond in the dispute instead of refunding, so the buyer is not compensated twice.",
        );
        await verifyRefundApproval(ctx, q, a.tenant, b);
        const rows = await q.query(
          "SELECT * FROM unit_settlements WHERE tenant_id=$1 AND batch_id=$2 AND unit_id=ANY($3::uuid[]) FOR UPDATE",
          [a.tenant, b.batch_id, b.unit_ids],
        );
        requireThat(
          rows.rows.length === b.unit_ids.length &&
            new Set(b.unit_ids).size === b.unit_ids.length,
          "refund_units_invalid",
          "Refund units must match captured units",
        );
        for (const row of rows.rows)
          requireThat(
            !(await ctx.db.getIn(
              q,
              a.tenant,
              "unit_remedy",
              String(row.unit_id),
            )),
            "remedy_exists",
            "A remedy is already reserved for this unit",
          );
        op.amount_minor = rows.rows.reduce(
          (sum, r) => sum + Number(r.amount_minor),
          0,
        );
        const account = await q.query(
          "SELECT * FROM money_accounts WHERE tenant_id=$1 AND batch_id=$2 FOR UPDATE",
          [a.tenant, b.batch_id],
        );
        const balance = account.rows[0];
        requireThat(
          balance &&
            Number(balance.refunded) +
              Number(balance.reserved_refund) +
              op.amount_minor <=
              Number(balance.captured),
          "refund_exceeds_capture",
          "Refund exceeds available captured amount",
        );
        await q.query(
          "UPDATE money_accounts SET reserved_refund=reserved_refund+$3 WHERE tenant_id=$1 AND batch_id=$2",
          [a.tenant, b.batch_id, op.amount_minor],
        );
        for (const unit of b.unit_ids)
          await ctx.db.put(q, a.tenant, "unit_remedy", unit, {
            id: unit,
            operation_id: op.id,
          });
        await ctx.db.put(q, a.tenant, "operation", op.id, op);
        await ctx.db.put(q, a.tenant, "refund_request", requestId, op);
        await ctx.db.enqueue(
          q,
          a.tenant,
          "payments",
          "/internal/operations/" + op.id + "/execute",
          {},
        );
        return op;
      });
    },
    z.strictObject({
      batch_id: uuid,
      unit_ids: z.array(uuid).min(1).max(10),
      reason: z.string().min(10).max(500),
      assessment_id: uuid.optional(),
      emergency: z.boolean(),
      proposal_id: uuid.optional(),
      approval_digest: z.string().length(64).optional(),
      review_actor: uuid.optional(),
    }),
  );
  app.post(
    "/v1/paypal/webhooks",
    {
      schema: {
        tags: ["payments"],
        security: [],
        summary:
          "PayPal signature-authenticated webhook; bearer token not used",
      },
    },
    async (req, reply) => {
      const paypal = ensure();
      const event = safeRecord(req.body);
      const headers = Object.fromEntries(
        Object.entries(req.headers)
          .filter(([k]) => k.startsWith("paypal-"))
          .map(([k, v]) => [k, String(v)]),
      );
      requireThat(
        await paypal.verifyWebhook(headers, event),
        "invalid_webhook",
        "Webhook signature verification failed",
        401,
      );
      // Tenant mapping is local account configuration (a connected merchant's PayPal id,
      // or the single configured tenant), never an untrusted custom_id.
      const tenant = await tenantForEvent(ctx, event);
      requireThat(
        tenant,
        "tenant_mapping_missing",
        "Webhook merchant mapping not configured",
        503,
      );
      uuid.parse(tenant);
      requireThat(
        typeof event.id === "string",
        "event_invalid",
        "Missing event ID",
        400,
      );
      const resource = event.resource as Json;
      const disputeId =
        String(event.event_type ?? "").startsWith("CUSTOMER.DISPUTE.") &&
        typeof resource?.dispute_id === "string" &&
        /^[A-Za-z0-9-]{4,64}$/.test(resource.dispute_id)
          ? resource.dispute_id
          : undefined;
      const op =
        !disputeId && typeof resource?.id === "string"
          ? await ctx.db.tx(tenant, async (q) => {
              const rows = await q.query<{ body: Operation }>(
                "SELECT body FROM entities WHERE tenant_id=$1 AND kind='operation' AND body->>'provider_id'=$2 LIMIT 1",
                [tenant, resource.id],
              );
              return rows.rows[0]?.body;
            })
          : undefined;
      const received = {
        id: id(),
        external_event_id: event.id,
        resource_id: resource?.id,
        event_type: event.event_type,
        received_at: now(),
      };
      await ctx.db.create(
        tenant,
        "webhook",
        event.id,
        event,
        received,
        disputeId
          ? {
              target: "payments",
              path: "/internal/disputes/" + disputeId + "/sync",
              body: {},
            }
          : op
            ? {
                target: "payments",
                path: "/internal/operations/" + op.id + "/reconcile",
                body: {},
              }
            : undefined,
      );
      return reply
        .code(200)
        .send({ accepted: true, matched: !!op || !!disputeId });
    },
  );
}
export async function reconcile(ctx: Context, tenant: string, key: string) {
  const op = await ctx.db.get<Operation>(tenant, "operation", key);
  requireThat(op, "not_found", "Operation not found", 404);
  if (op.state === "CONFIRMED" || op.state === "RESERVED") return op;
  requireThat(
    ctx.paypal?.available,
    "integration_unavailable",
    "PayPal is required for read-back",
    503,
  );
  const o = payOptions(ctx, op);
  let resource: Json;
  if (op.kind === "VOID")
    resource = await ctx.paypal.getAuthorization(String(op.authorization_id), o);
  else if (op.provider_id)
    resource =
      op.kind === "REFUND"
        ? await ctx.paypal.getRefund(op.provider_id, o)
        : await ctx.paypal.getCapture(op.provider_id, o);
  else {
    // A lost capture response can be recovered only through the original approved order.
    if (op.kind === "CAPTURE" && op.order_id) {
      const order = await ctx.paypal.getOrder(String(op.order_id), o);
      const units = order.purchase_units as Json[] | undefined;
      const unit = units?.[0];
      const payments = unit?.payments as Json | undefined;
      const auths = payments?.authorizations as Json[] | undefined;
      const captures = payments?.captures as Json[] | undefined;
      const candidates =
        captures?.filter((c) => amountMatches(c, op.amount_minor, o.currency)) ?? [];
      if (
        units?.length === 1 &&
        unit?.reference_id === op.batch_id &&
        auths?.some((a) => a.id === op.authorization_id) &&
        candidates.length === 1 &&
        typeof candidates[0]?.id === "string"
      ) {
        const recoveredId = String(candidates[0].id);
        await ctx.db.mutate<Operation>(tenant, "operation", key, async (old) =>
          old.provider_id || old.state === "CONFIRMED"
            ? old
            : { ...old, provider_id: recoveredId },
        );
        return reconcile(ctx, tenant, key);
      }
    }
    return ctx.db.mutate<Operation>(tenant, "operation", key, async (old) =>
      old.state === "CONFIRMED" || old.provider_id
        ? old
        : {
            ...old,
            state: "NEEDS_REVIEW",
            error_code: "resource_correlation_required",
          },
    );
  }
  let confirmed = false;
  if (op.kind === "VOID")
    confirmed =
      resource.status === "VOIDED" && resource.id === op.authorization_id;
  else if (op.kind === "REFUND")
    confirmed =
      resource.status === "COMPLETED" &&
      resource.id === op.provider_id &&
      amountMatches(resource, op.amount_minor, o.currency) &&
      refundReferencesCapture(resource, String(op.capture_id));
  else {
    const related = (resource.supplementary_data as Json | undefined)
      ?.related_ids as Json | undefined;
    confirmed =
      resource.status === "COMPLETED" &&
      resource.id === op.provider_id &&
      verifyMoney(resource, op.amount_minor, o.merchantId, o.currency) &&
      related?.authorization_id === op.authorization_id;
  }
  if (!confirmed)
    return ctx.db.mutate<Operation>(tenant, "operation", key, async (old) =>
      old.state === "CONFIRMED" || old.provider_id !== op.provider_id
        ? old
        : {
            ...old,
            state: resource.status === "PENDING" ? "PENDING" : "NEEDS_REVIEW",
          },
    );
  return ctx.db.tx(tenant, async (q) => {
    const current = await ctx.db.getIn<Operation>(
      q,
      tenant,
      "operation",
      key,
      true,
    );
    requireThat(current, "not_found", "Operation not found", 404);
    if (current.state === "CONFIRMED" || current.provider_id !== op.provider_id)
      return current;
    if (op.kind === "CAPTURE")
      await q.query(
        "UPDATE money_accounts SET captured=captured+$3 WHERE tenant_id=$1 AND batch_id=$2",
        [tenant, op.batch_id, op.amount_minor],
      );
    if (op.kind === "REFUND")
      await q.query(
        "UPDATE money_accounts SET reserved_refund=reserved_refund-$3,refunded=refunded+$3 WHERE tenant_id=$1 AND batch_id=$2",
        [tenant, op.batch_id, op.amount_minor],
      );
    const result = { ...current, state: "CONFIRMED", confirmed_at: now() };
    await ctx.db.put(q, tenant, "operation", key, result);
    await q.query(
      "INSERT INTO financial_journal(tenant_id,operation_id,event_kind,amount_minor,currency,provider_reference,resource_digest) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        tenant,
        key,
        op.kind,
        op.amount_minor,
        o.currency,
        op.provider_id ?? op.authorization_id,
        digest(resource),
      ],
    );
    await ctx.db.put(q, tenant, "receipt", key, {
      id: key,
      batch_id: op.batch_id,
      kind: op.kind,
      amount_minor: op.amount_minor,
      currency: o.currency,
      provider_id: op.provider_id ?? op.authorization_id,
      status: resource.status,
    });
    await ctx.db.enqueue(q, tenant, "commerce", "/internal/payment-outcomes", {
      batch_id: op.batch_id,
      operation_id: key,
    });
    return result;
  });
}

function payOptionsRecord(ctx: Context, r: Json | undefined) {
  const o = payOptions(ctx, r);
  return { currency: o.currency, merchant_id: o.merchantId };
}
async function tenantForEvent(ctx: Context, event: Json) {
  const resource = (event.resource ?? {}) as Json;
  const disputed = (resource.disputed_transactions as Json[] | undefined)?.[0];
  const merchant =
    (resource.payee as Json | undefined)?.merchant_id ??
    (disputed?.seller as Json | undefined)?.merchant_id;
  if (typeof merchant === "string" && merchant !== ctx.merchantId) {
    const connected = await tenantForMerchant(ctx, merchant);
    if (connected) return connected;
  }
  return process.env.MERCHANT_TENANT_ID;
}
