import "./config.js";
import { configuredInvestigator } from "../src/adapters/models.js";
import { id } from "../src/domain/contracts.js";
import { mkdir, writeFile } from "node:fs/promises";
const unit = id();
const e = [
  {
    id: id(),
    source: "provider" as const,
    unit_id: unit,
    text: "Original task task-fixture-001 reports SUCCEEDED. This is explicitly synthetic evidence for a real model connectivity check.",
  },
  {
    id: id(),
    source: "delivery" as const,
    unit_id: unit,
    text: "The video is archived and technically validated, but buyer access is not published.",
  },
];
try {
  const model = configuredInvestigator({
    ...process.env,
    AI_FALLBACK_PROVIDERS: "",
  });
  const result = await model.assess(e);
  const report = {
    timestamp: new Date().toISOString(),
    test: "actual Gemini request with synthetic evidence",
    provider_video_generated: false,
    paypal_transaction: false,
    ...result,
  };
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/gemini-connectivity.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      status: "passed",
      model: result.model,
      disposition: result.assessment.disposition,
      provenance: result.provenance,
    }),
  );
} catch {
  console.log(
    JSON.stringify({
      status: "failed",
      reason:
        "Gemini unavailable, invalid schema or unsupported citations; no credentials printed",
    }),
  );
  process.exitCode = 1;
}
