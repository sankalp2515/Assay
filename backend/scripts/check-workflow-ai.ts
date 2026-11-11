import "./config.js";
import { harness } from "../test/harness.js";
import { configuredInvestigator } from "../src/adapters/models.js";
import { mkdir, writeFile } from "node:fs/promises";
import type { Json } from "../src/domain/contracts.js";
const h = await harness();
try {
  h.contexts.investigation.model = configuredInvestigator(process.env);
  const batch = await h.setup(1);
  const artifacts = await h.seed(batch, 1, false);
  const assessment = await h.request(
    "/v1/batches/" + batch.id + "/investigate",
    {},
  );
  const report = assessment.json<Json>();
  if (report.state !== "VALID")
    throw new Error("AI did not produce a supported assessment");
  const recovery = await h.request("/v1/batches/" + batch.id + "/recover", {
    artifact_id: artifacts[0]!.id,
    assessment_id: report.id,
  });
  if (recovery.statusCode !== 200) throw new Error("Recovery rejected");
  const settlement = await h.settle(batch);
  const result = await settlement.execute();
  if (result.state !== "CONFIRMED")
    throw new Error("Fixture settlement did not confirm");
  const evidence = {
    timestamp: new Date().toISOString(),
    actual_model: true,
    model: report.model,
    assessment_provenance: report.provenance,
    model_tool_calls: report.tool_calls,
    actual_provider_generation: false,
    video_source: "deterministic locally generated MP4 fixture",
    paypal_environment: "fixture, no sandbox API called",
    recovered_original_fixture: true,
    amount_minor: result.amount_minor,
    state: result.state,
  };
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/real-ai-fixture-workflow.json",
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence));
} catch {
  console.log(
    JSON.stringify({
      status: "failed",
      reason:
        "Real AI workflow did not complete. No provider/sandbox transaction claimed.",
    }),
  );
  process.exitCode = 1;
} finally {
  await h.close();
}
