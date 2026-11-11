import "./config.js";
import { configuredInvestigator } from "../src/adapters/models.js";
import { id } from "../src/domain/contracts.js";
import { writeFile } from "node:fs/promises";
const unit = id();
const evidence = [
  {
    id: id(),
    source: "provider" as const,
    unit_id: unit,
    text: "Synthetic test evidence: original task completed successfully.",
  },
  {
    id: id(),
    source: "delivery" as const,
    unit_id: unit,
    text: "Synthetic test evidence: original archive validated; purchaser access is not published.",
  },
];
const results = [];
for (const provider of ["gemini", "groq", "nvidia"] as const) {
  const env = {
    ...process.env,
    GEMINI_API_KEY: provider === "gemini" ? process.env.GEMINI_API_KEY : "",
    AI_FALLBACK_PROVIDERS: provider === "gemini" ? "" : provider,
  };
  const model = configuredInvestigator(env);
  const start = Date.now();
  try {
    const result = await model.assess(evidence);
    results.push({
      provider,
      passed: true,
      model: result.model,
      disposition: result.assessment.disposition,
      citations_validated: true,
      elapsed_ms: Date.now() - start,
    });
  } catch {
    results.push({
      provider,
      passed: false,
      configured_and_admitted: model.available,
      elapsed_ms: Date.now() - start,
    });
  }
  console.log(JSON.stringify(results.at(-1)));
}
await writeFile(
  "evidence/ai-providers.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      actual_api_calls: true,
      evidence_source: "synthetic incident evidence",
      results,
      limitations: [
        "connectivity/schema/citation checks only",
        "not held-out benefit or market validation",
        "no media generation or PayPal transaction",
      ],
    },
    null,
    2,
  ),
);
if (results.some((r) => !r.passed)) process.exitCode = 1;
