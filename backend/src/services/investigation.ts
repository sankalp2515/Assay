import type { FastifyInstance } from "fastify";
import type { Context } from "../core/context.js";
import { endpoint } from "../core/http.js";
import { requireThat } from "../core/errors.js";
import {
  digest,
  id,
  uuid,
  evidenceSchema,
  now,
  stableId,
  type Evidence,
  type Json,
} from "../domain/contracts.js";
import { z } from "zod";
export function investigationRoutes(app: FastifyInstance, ctx: Context) {
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/assessments",
    ["commerce"],
    undefined,
    async (a, raw, _p, key) => {
      const b = raw as {
        batch_id: string;
        evidence: Evidence[];
        snapshot_hash: string;
        refresh_reason?: string;
      };
      requireThat(
        ctx.model?.available,
        "waiting_for_ai",
        "A configured AI investigator is required",
        503,
      );
      const record = {
        id: id(),
        batch_id: b.batch_id,
        snapshot_hash: b.snapshot_hash,
        state: "RESERVED",
        created_at: now(),
        evidence: b.evidence,
        ...(b.refresh_reason ? { refresh_reason: b.refresh_reason } : {}),
      };
      return ctx.db.create(
        a.tenant,
        "assessment",
        key,
        b,
        record,
        {
          target: "investigation",
          path: "/internal/assessments/" + record.id + "/run",
          body: {},
        },
        async (q) => {
          const date = new Date(ctx.now()).toISOString().slice(0, 10);
          const budgetId = stableId({ tenant: a.tenant, date });
          await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            a.tenant + "ai-budget-" + date,
          ]);
          const budget = await ctx.db.getIn<Json>(
            q,
            a.tenant,
            "ai_budget",
            budgetId,
            true,
          );
          const used = Number(budget?.used ?? 0);
          const cap = Math.min(
            500,
            Math.max(1, Number(process.env.MAX_AI_ASSESSMENTS_PER_DAY ?? 50)),
          );
          requireThat(
            Number.isFinite(cap) && used < cap,
            "ai_budget_exhausted",
            "Daily investigation budget exhausted",
            429,
          );
          await ctx.db.put(q, a.tenant, "ai_budget", budgetId, {
            id: budgetId,
            date,
            used: used + 1,
          });
        },
      );
    },
    z.strictObject({
      batch_id: uuid,
      evidence: z.array(evidenceSchema).min(1).max(50),
      snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/),
      refresh_reason: z.string().min(10).max(500).optional(),
    }),
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/assessments/:assessment/run",
    ["investigation"],
    undefined,
    async (a, _raw, p) => {
      const record = await ctx.db.get<Json>(
        a.tenant,
        "assessment",
        uuid.parse(p.assessment),
      );
      requireThat(record, "not_found", "Assessment not found", 404);
      if (record.state !== "RESERVED") return record;
      requireThat(
        ctx.model?.available,
        "waiting_for_ai",
        "AI is unavailable",
        503,
      );
      const b = {
        batch_id: String(record.batch_id),
        evidence: record.evidence as Evidence[],
      };
      await ctx.db.mutate(
        a.tenant,
        "assessment",
        String(record.id),
        async (old) => {
          requireThat(
            old.state === "RESERVED",
            "already_running",
            "Assessment is already running",
          );
          return { ...old, state: "RUNNING", started_at: now() };
        },
      );
      try {
        const result = await ctx.model.assess(b.evidence, async (unit) => {
          const list = await ctx.call(
            "provider",
            "/internal/batches/" + b.batch_id + "/attempts",
            a.tenant,
          );
          const attempts = list.attempts as Json[];
          const matching = attempts.filter((t) => t.unit_id === unit);
          const fresh: Evidence[] = [];
          for (const attempt of matching.slice(0, 2)) {
            const read = await ctx.call(
              "provider",
              "/internal/attempts/" + attempt.id,
              a.tenant,
            );
            fresh.push({
              id: id(),
              source: "provider",
              unit_id: unit,
              text: `Current provider task ${String(read.provider_task_id)} reports ${String(read.state)}.`,
            });
          }
          return fresh;
        });
        requireThat(
          result.provenance === "real" || ctx.fixture,
          "model_provenance",
          "Fixture model cannot satisfy a sandbox assessment",
        );
        return await ctx.db.mutate(
          a.tenant,
          "assessment",
          String(record.id),
          async (old) => ({
            ...old,
            state:
              result.assessment.disposition === "INCONCLUSIVE"
                ? "INCONCLUSIVE"
                : "VALID",
            assessment: result.assessment,
            model: result.model,
            provenance: result.provenance,
            tool_calls: result.tool_calls,
            attempted_models: result.attempted_models ?? [],
            evidence: result.evidence ?? b.evidence,
            evidence_hash: digest(result.evidence ?? b.evidence),
            completed_at: now(),
          }),
        );
      } catch (err) {
        // Keep the reason in the service log (no evidence text or keys), so a failed
        // reassessment can be diagnosed instead of only showing "AI unavailable".
        app.log.warn(
          { assessment: String(record.id), reason: String((err as Error)?.message ?? err).slice(0, 300) },
          "assessment failed",
        );
        return ctx.db.mutate(
          a.tenant,
          "assessment",
          String(record.id),
          async (old) => ({
            ...old,
            state: "WAITING_FOR_AI",
            error_code: "assessment_unavailable_or_invalid",
          }),
        );
      }
    },
  );
  // Buyer-message reading shares the per-tenant daily AI budget with investigations.
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/claims/interpret",
    ["commerce"],
    undefined,
    async (a, raw) => {
      const b = raw as { message: string; clip_count: number };
      const reader = ctx.model;
      requireThat(
        reader?.available && reader.interpret,
        "waiting_for_ai",
        "A configured AI reader is required",
        503,
      );
      await ctx.db.tx(a.tenant, async (q) => {
        const date = new Date(ctx.now()).toISOString().slice(0, 10);
        const budgetId = stableId({ tenant: a.tenant, date });
        await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          a.tenant + "ai-budget-" + date,
        ]);
        const budget = await ctx.db.getIn<Json>(
          q,
          a.tenant,
          "ai_budget",
          budgetId,
          true,
        );
        const used = Number(budget?.used ?? 0);
        const cap = Math.min(
          500,
          Math.max(1, Number(process.env.MAX_AI_ASSESSMENTS_PER_DAY ?? 50)),
        );
        requireThat(
          used < cap,
          "ai_budget_exhausted",
          "Daily AI budget exhausted",
          429,
        );
        await ctx.db.put(q, a.tenant, "ai_budget", budgetId, {
          id: budgetId,
          date,
          used: used + 1,
        });
      });
      const result = await reader.interpret!(b.message, b.clip_count);
      requireThat(
        result.provenance === "real" || ctx.fixture,
        "model_provenance",
        "Fixture reader cannot serve a sandbox request",
      );
      return {
        interpretation: result.interpretation,
        model: result.model,
        provenance: result.provenance,
        attempted_models: result.attempted_models ?? [],
        message_hash: digest(b.message),
      };
    },
    z.strictObject({
      message: z.string().min(3).max(2000),
      clip_count: z.number().int().min(1).max(10),
    }),
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/internal/assessments/:assessment",
    ["commerce", "payments", "delivery"],
    undefined,
    async (a, _b, p) => {
      const record = await ctx.db.get(
        a.tenant,
        "assessment",
        uuid.parse(p.assessment),
      );
      requireThat(record, "not_found", "Assessment not found", 404);
      return record;
    },
  );
}
