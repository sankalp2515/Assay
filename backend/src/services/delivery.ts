import type { FastifyInstance } from "fastify";
import type { Context } from "../core/context.js";
import { endpoint } from "../core/http.js";
import { authenticate, authorize, token } from "../core/auth.js";
import { requireThat } from "../core/errors.js";
import { id, uuid, digest, now, type Json } from "../domain/contracts.js";
import { downloadOutput, isolatedVerification } from "../adapters/media.js";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
export function deliveryRoutes(app: FastifyInstance, ctx: Context) {
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/artifacts",
    ["commerce"],
    undefined,
    async (a, raw, _p, key) => {
      const b = raw as { batch_id: string; attempt_id: string };
      const contract = await ctx.call(
        "commerce",
        "/internal/batches/" + b.batch_id,
        a.tenant,
      );
      const attempt = await ctx.call(
        "provider",
        "/internal/attempts/" + b.attempt_id,
        a.tenant,
      );
      requireThat(
        attempt.batch_id === b.batch_id && attempt.state === "SUCCEEDED",
        "output_not_ready",
        "Known successful attempt required",
      );
      const resource = attempt.resource as Json;
      const output = resource.output as string[] | undefined;
      requireThat(
        output?.[0],
        "output_missing",
        "Provider output is unavailable",
      );
      const record = await ctx.db.create(a.tenant, "artifact", key, b, {
        id: id(),
        batch_id: b.batch_id,
        unit_id: attempt.unit_id,
        buyer_id: contract.buyer_id,
        contract_hash: contract.contract_hash,
        state: "RESERVED",
        published: false,
        retention_until: contract.retention_until,
        attempt_id: b.attempt_id,
      });
      if (record.state !== "RESERVED") return publicArtifact(record);
      await ctx.db.mutate(
        a.tenant,
        "artifact",
        String(record.id),
        async (old) => {
          requireThat(
            old.state === "RESERVED",
            "already_copying",
            "Artifact already being preserved",
          );
          return { ...old, state: "COPYING" };
        },
      );
      await mkdir(ctx.artifactDir, { recursive: true, mode: 0o700 });
      const path = join(ctx.artifactDir, String(record.id) + ".mp4");
      try {
        await downloadOutput(
          output[0],
          path,
          (
            process.env.RUNWAY_ALLOWED_HOSTS ?? "dnznrvs05pmza.cloudfront.net"
          ).split(","),
        );
        const check = await isolatedVerification(path);
        const result = await ctx.db.mutate(
          a.tenant,
          "artifact",
          String(record.id),
          async (old) => ({
            ...old,
            state: "STORED",
            ...check,
            stored_at: now(),
          }),
        );
        return publicArtifact(result);
      } catch {
        return ctx.db
          .mutate(a.tenant, "artifact", String(record.id), async (old) => ({
            ...old,
            state: "QUARANTINED",
            error_code: "copy_or_verification_failed",
          }))
          .then(publicArtifact);
      }
    },
    z.strictObject({ batch_id: uuid, attempt_id: uuid }),
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/internal/batches/:batch/artifacts",
    ["commerce", "investigation", "payments"],
    undefined,
    async (a, _b, p) => ({
      artifacts: (
        await ctx.db.list(a.tenant, "artifact", uuid.parse(p.batch))
      ).map(publicArtifact),
    }),
  );
  app.get(
    "/v1/artifacts/:artifact/content",
    {
      preHandler: async (req) => {
        req.actor = await authenticate(
          req.headers.authorization,
          ctx.identity,
          "delivery",
        );
        authorize(req.actor, ["commerce", "delivery"], ["buyer", "verifier"]);
      },
    },
    async (req, reply) => {
      const key = uuid.parse((req.params as { artifact: string }).artifact);
      const artifact = await ctx.db.get<Json>(
        req.actor.tenant,
        "artifact",
        key,
      );
      requireThat(
        artifact && artifact.buyer_id === req.actor.subject,
        "not_found",
        "Artifact not found",
        404,
      );
      requireThat(
        artifact.published === true &&
          artifact.state === "STORED" &&
          Date.parse(String(artifact.retention_until)) > ctx.now(),
        "not_retrievable",
        "Artifact is not currently retrievable",
        409,
      );
      const bytes = await readFile(join(ctx.artifactDir, key + ".mp4"));
      requireThat(
        createHash("sha256").update(bytes).digest("hex") === artifact.sha256,
        "artifact_integrity",
        "Stored file integrity check failed",
        503,
      );
      reply.header("cache-control", "private, no-store").type("video/mp4");
      return reply.send(bytes);
    },
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/artifacts/:artifact/publish",
    ["commerce"],
    undefined,
    async (a, raw, p) => {
      const b = raw as { assessment_id: string };
      const key = uuid.parse(p.artifact);
      const old = await ctx.db.get<Json>(a.tenant, "artifact", key);
      requireThat(old, "not_found", "Artifact not found", 404);
      const assessment = await ctx.call(
        "investigation",
        "/internal/assessments/" + b.assessment_id,
        a.tenant,
      );
      requireThat(
        assessment.batch_id === old.batch_id &&
          assessment.state === "VALID" &&
          (assessment.provenance === "real" || ctx.fixture),
        "assessment_required",
        "A valid AI recovery assessment is required",
      );
      const actions = (assessment.assessment as Json).actions as Json[];
      requireThat(
        actions.some(
          (action) =>
            action.kind === "RESTORE_ACCESS" && action.unit_id === old.unit_id,
        ),
        "recovery_not_supported",
        "AI assessment does not support this recovery action",
      );
      const artifact = await ctx.db.mutate(
        a.tenant,
        "artifact",
        key,
        async (body) => {
          requireThat(
            body.state === "STORED",
            "invalid_artifact",
            "Only validated stored output may be published",
          );
          return { ...body, published: true };
        },
      );
      const access = await app.inject({
        url: "/v1/artifacts/" + key + "/content",
        headers: {
          authorization:
            "Bearer " +
            (await token(
              ctx.identity,
              "delivery",
              a.tenant,
              "verifier",
              String(artifact.buyer_id),
            )),
        },
      });
      requireThat(
        access.statusCode === 200 &&
          createHash("sha256").update(access.rawPayload).digest("hex") ===
            artifact.sha256,
        "buyer_route_failed",
        "Purchaser route verification failed",
      );
      const receipt = {
        id: id(),
        batch_id: artifact.batch_id,
        unit_id: artifact.unit_id,
        artifact_id: key,
        buyer_id: artifact.buyer_id,
        contract_hash: artifact.contract_hash,
        sha256: artifact.sha256,
        checker_version: "buyer-route-v1",
        observed_at: now(),
        valid_until: new Date(
          Math.min(
            ctx.now() + 5 * 60_000,
            Date.parse(String(artifact.retention_until)),
          ),
        ).toISOString(),
        outcome: "VERIFIED",
        receipt_hash: digest(artifact),
      };
      await ctx.db.create(
        a.tenant,
        "verification",
        "publish-" + key + "-" + b.assessment_id,
        receipt,
        receipt,
      );
      return receipt;
    },
    z.strictObject({ assessment_id: uuid }),
  );
  endpoint(
    app,
    ctx,
    "POST",
    "/internal/batches/:batch/verify",
    ["commerce", "payments"],
    undefined,
    async (a, _b, p) => {
      const artifacts = await ctx.db.list<Json>(
        a.tenant,
        "artifact",
        uuid.parse(p.batch),
      );
      const receipts: Json[] = [];
      for (const artifact of artifacts.filter(
        (x) => x.published && x.state === "STORED",
      )) {
        const response = await app.inject({
          url: "/v1/artifacts/" + artifact.id + "/content",
          headers: {
            authorization:
              "Bearer " +
              (await token(
                ctx.identity,
                "delivery",
                a.tenant,
                "verifier",
                String(artifact.buyer_id),
              )),
          },
        });
        if (
          response.statusCode === 200 &&
          createHash("sha256").update(response.rawPayload).digest("hex") ===
            artifact.sha256
        ) {
          const receipt = {
            id: id(),
            batch_id: p.batch,
            unit_id: artifact.unit_id,
            artifact_id: artifact.id,
            buyer_id: artifact.buyer_id,
            contract_hash: artifact.contract_hash,
            sha256: artifact.sha256,
            observed_at: now(),
            valid_until: new Date(ctx.now() + 60_000).toISOString(),
            outcome: "VERIFIED",
          };
          await ctx.db.create(
            a.tenant,
            "verification",
            String(receipt.id),
            receipt,
            receipt,
          );
          receipts.push(receipt);
        }
      }
      return { receipts };
    },
  );
  endpoint(
    app,
    ctx,
    "GET",
    "/internal/verifications/:verification",
    ["payments", "commerce"],
    undefined,
    async (a, _b, p) => {
      const receipt = await ctx.db.get(
        a.tenant,
        "verification",
        uuid.parse(p.verification),
      );
      requireThat(receipt, "not_found", "Verification not found", 404);
      return receipt;
    },
  );
}
function publicArtifact(a: Json) {
  const {
    id,
    batch_id,
    unit_id,
    buyer_id,
    contract_hash,
    state,
    published,
    sha256,
    retention_until,
    width,
    height,
    duration,
    bytes,
    stored_at,
  } = a;
  return {
    id,
    batch_id,
    unit_id,
    buyer_id,
    contract_hash,
    state,
    published,
    sha256,
    retention_until,
    width,
    height,
    duration,
    bytes,
    stored_at,
  };
}
