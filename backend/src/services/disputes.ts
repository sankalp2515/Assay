import type { FastifyInstance } from "fastify";
import type { Context } from "../core/context.js";
import type { Sql } from "../core/database.js";
import { endpoint } from "../core/http.js";
import { requireThat } from "../core/errors.js";
import { now, stableId, uuid, type Json, type Operation } from "../domain/contracts.js";
import { merchantFor } from "./merchants.js";

// PayPal disputes (CUSTOMER.DISPUTE.*). The webhook only says "look at dispute X":
// the record here comes from reading the dispute back from PayPal. A dispute is linked
// to a batch only through a capture this service confirmed. While it is open, refunds on
// that batch are refused, because a refund plus a lost dispute would pay the buyer twice.
// The merchant answers the dispute in PayPal; the signed delivery statement is the evidence.
const CLOSED = new Set(["RESOLVED"]);
const disputeId = /^[A-Za-z0-9-]{4,64}$/;

export async function openDispute(ctx: Context, q: Sql, tenant: string, batch: string) {
  const rows = await q.query<{ body: Json }>(
    "SELECT body FROM entities WHERE tenant_id=$1 AND kind='dispute' AND body->>'batch_id'=$2",
    [tenant, batch],
  );
  return rows.rows.map((r) => r.body).find((d) => !CLOSED.has(String(d.status)));
}

export function disputeRoutes(app: FastifyInstance, ctx: Context) {
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/disputes/:dispute/sync",
    ["payments"],
    undefined,
    async (a, _b, p) => {
      const id = String(p.dispute);
      requireThat(disputeId.test(id), "invalid_request", "Invalid dispute id", 400);
      requireThat(
        ctx.paypal?.available && ctx.paypal.getDispute,
        "integration_unavailable",
        "PayPal is required for dispute read-back",
        503,
      );
      const merchant = await merchantFor(ctx, a.tenant);
      const d = await ctx.paypal.getDispute(id, { merchantId: merchant });
      requireThat(d.dispute_id === id, "dispute_mismatch", "PayPal returned a different dispute", 502);
      const transactions = (d.disputed_transactions as Json[] | undefined) ?? [];
      const sellerIds = transactions
        .map((t) => t.seller_transaction_id)
        .filter((x): x is string => typeof x === "string");
      return ctx.db.tx(a.tenant, async (q) => {
        await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenant + "dispute" + id]);
        const ops = sellerIds.length
          ? await q.query<{ body: Operation }>(
              "SELECT body FROM entities WHERE tenant_id=$1 AND kind='operation' AND body->>'kind'='CAPTURE' AND body->>'state'='CONFIRMED' AND body->>'provider_id'=ANY($2::text[])",
              [a.tenant, sellerIds],
            )
          : { rows: [] };
        const capture = ops.rows[0]?.body;
        const key = stableId({ dispute: id });
        const prior = await ctx.db.getIn<Json>(q, a.tenant, "dispute", key, true);
        const amount = d.dispute_amount as Json | undefined;
        const record = {
          id: key,
          dispute_id: id,
          batch_id: capture?.batch_id ?? null,
          capture_operation_id: capture?.id ?? null,
          capture_id: capture?.provider_id ?? null,
          status: String(d.status ?? "OTHER"),
          reason: String(d.reason ?? "OTHER"),
          stage: String(d.dispute_life_cycle_stage ?? ""),
          amount: amount
            ? { currency_code: String(amount.currency_code), value: String(amount.value) }
            : null,
          seller_response_due_date: d.seller_response_due_date ?? null,
          outcome: (d.dispute_outcome as Json | undefined)?.outcome_code ?? null,
          read_back_at: now(),
          first_seen_at: prior?.first_seen_at ?? now(),
        };
        await ctx.db.put(q, a.tenant, "dispute", key, record);
        if (capture && prior?.status !== record.status)
          await ctx.db.enqueue(q, a.tenant, "commerce", "/internal/disputes/notify", {
            batch_id: capture.batch_id,
            dispute_id: id,
            status: record.status,
            reason: record.reason,
            event_key: key + ":" + record.status,
            first: !prior,
            amount: record.amount,
            seller_response_due_date: record.seller_response_due_date,
          });
        return record;
      });
    },
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/internal/batches/:batch/disputes",
    ["commerce"],
    undefined,
    async (a, _b, p) => ({
      disputes: await ctx.db.list(a.tenant, "dispute", uuid.parse(p.batch)),
    }),
  );
}
