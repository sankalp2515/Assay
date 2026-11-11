import type { FastifyInstance } from "fastify";
import type { Context } from "../core/context.js";
import { endpoint } from "../core/http.js";
import { requireThat } from "../core/errors.js";
import { TASK_SOURCES, outputHosts, providerFor, type TaskSource } from "../domain/sources.js";
import { id, uuid, now, type Json } from "../domain/contracts.js";
import { z } from "zod";
export function providerRoutes(app: FastifyInstance, ctx: Context) {
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/attempts",
    ["commerce"],
    undefined,
    async (a, raw, _p, key) => {
      const b = raw as {
        batch_id: string;
        unit_id: string;
        prompt: string;
        provider_task_id?: string;
        source?: TaskSource;
        output_url?: string;
      };
      const replay = await ctx.db.commandResult(a.tenant, "attempt", key, b);
      if (replay) return replay;
      const reported = b.source === "reported";
      requireThat(
        !reported || (!!b.provider_task_id && !!b.output_url),
        "reported_task_incomplete",
        "A reported task needs its provider task ID and output URL",
      );
      requireThat(
        !!b.output_url === reported,
        "output_url_not_allowed",
        "Only reported tasks carry an output URL; other sources are looked up",
      );
      if (reported) {
        let host = "";
        try {
          const u = new URL(b.output_url!);
          if (!u.username && !u.password && (!u.port || u.port === "443"))
            host = u.hostname.toLowerCase();
        } catch {
          host = "";
        }
        requireThat(
          outputHosts("reported").includes(host),
          "unsafe_output_origin",
          "Output host is not in REPORTED_OUTPUT_HOSTS",
          422,
        );
      } else providerFor(ctx, b.source);
      const contract = await ctx.call(
        "commerce",
        "/internal/batches/" + b.batch_id,
        a.tenant,
      );
      requireThat(
        (contract.units as Json[]).some((u) => u.id === b.unit_id) &&
          contract.prompt === b.prompt &&
          ["AUTHORIZED", "RUNNING"].includes(String(contract.state)) &&
          Date.parse(String(contract.deadline)) > ctx.now(),
        "invalid_generation_scope",
        "Known unit and active accepted contract required",
      );
      const auth = await ctx.call(
        "payments",
        "/internal/batches/" + b.batch_id + "/authorization",
        a.tenant,
      );
      requireThat(
        auth.state === "AUTHORIZED",
        "authorization_required",
        "Confirmed authorization is required",
      );
      const previous = await ctx.db.list<Json>(a.tenant, "attempt", b.batch_id);
      requireThat(
        !previous.some((p) => p.unit_id === b.unit_id),
        "unit_attempt_exists",
        "Use lookup for the existing attempt; a second attempt requires a new spending policy",
      );
      if (!b.provider_task_id)
        requireThat(
          ctx.allowPaid && ctx.maxAttempts >= 1,
          "inference_disabled",
          "Paid inference must be explicitly enabled and capped",
          403,
        );
      const record = await ctx.db.create(a.tenant, "attempt", key, b, {
        id: id(),
        batch_id: b.batch_id,
        unit_id: b.unit_id,
        state: "RESERVED",
        created_at: now(),
        source: b.source ?? "runway",
        ...(b.provider_task_id ? { provider_task_id: b.provider_task_id } : {}),
      });
      if (record.state !== "RESERVED") return record;
      if (reported)
        return ctx.db.mutate(a.tenant, "attempt", record.id as string, async (old) => ({
          ...old,
          state: "SUCCEEDED",
          provider_task_id: b.provider_task_id,
          resource: {
            id: b.provider_task_id!,
            status: "SUCCEEDED",
            output: [b.output_url!],
            provider: "reported",
            evidence: "merchant_reported",
          },
        }));
      await ctx.db.mutate(
        a.tenant,
        "attempt",
        record.id as string,
        async (old) => {
          requireThat(
            old.state === "RESERVED",
            "already_dispatched",
            "Attempt already dispatched",
          );
          return { ...old, state: "DISPATCHING" };
        },
      );
      try {
        const source = providerFor(ctx, b.source);
        const response = b.provider_task_id
          ? await source.lookup(b.provider_task_id)
          : await source.submit(b.prompt);
        requireThat(
          typeof response.id === "string",
          "provider_response_invalid",
          "Provider returned no task ID",
          502,
        );
        return await ctx.db.mutate(
          a.tenant,
          "attempt",
          record.id as string,
          async (old) => ({
            ...old,
            state: String(response.status ?? "RUNNING"),
            provider_task_id: response.id,
            resource: response,
          }),
        );
      } catch {
        return ctx.db.mutate(
          a.tenant,
          "attempt",
          record.id as string,
          async (old) => ({
            ...old,
            state: b.provider_task_id
              ? "LOOKUP_UNAVAILABLE"
              : "SUBMISSION_UNKNOWN",
          }),
        );
      }
    },
    z.strictObject({
      batch_id: uuid,
      unit_id: uuid,
      prompt: z.string().min(5).max(2000),
      provider_task_id: z.string().min(1).max(100).optional(),
      source: z.enum(TASK_SOURCES).optional(),
      output_url: z.string().regex(/^https:\/\/\S+$/).max(2000).optional(),
    }),
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/internal/batches/:batch/attempts",
    ["commerce", "investigation", "delivery"],
    undefined,
    async (a, _b, p) => ({
      attempts: await ctx.db.list(a.tenant, "attempt", uuid.parse(p.batch)),
    }),
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/internal/attempts/:attempt",
    ["commerce", "investigation", "delivery"],
    undefined,
    async (a, _b, p) => {
      const attempt = await ctx.db.get<Json>(
        a.tenant,
        "attempt",
        uuid.parse(p.attempt),
      );
      requireThat(attempt, "not_found", "Attempt not found", 404);
      if (!attempt.provider_task_id || attempt.source === "reported")
        return attempt;
      const resource = await providerFor(
        ctx,
        attempt.source as TaskSource | undefined,
      ).lookup(
        String(attempt.provider_task_id),
      );
      return ctx.db.mutate(
        a.tenant,
        "attempt",
        String(attempt.id),
        async (old) => ({
          ...old,
          state: String(resource.status ?? "UNKNOWN"),
          resource,
        }),
      );
    },
  );
}
