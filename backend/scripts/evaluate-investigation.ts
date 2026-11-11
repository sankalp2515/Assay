import "./config.js";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { configuredInvestigator } from "../src/adapters/models.js";
import { stableId, type Evidence } from "../src/domain/contracts.js";
import { baseline, incidents } from "../evaluation/incidents.js";

const model = configuredInvestigator({
  ...process.env,
  AI_ZERO_COST_ONLY: "true",
  AI_FALLBACK_PROVIDERS: "",
});
if (!model.available)
  throw new Error("Confirmed Gemini free-tier access is required");
const fixtureSha256 = createHash("sha256")
  .update(await readFile("evaluation/incidents.ts"))
  .digest("hex");
const rows = [];
for (const { expected, ...incident } of incidents) {
  const unit = stableId({ incident: incident.id, role: "unit" });
  const evidence: Evidence[] = [
    {
      id: stableId({ unit, source: "provider" }),
      source: "provider",
      unit_id: unit,
      text: `Current recorded task status: ${incident.task}. ${incident.note}`,
    },
    {
      id: stableId({ unit, source: "delivery" }),
      source: "delivery",
      unit_id: unit,
      text: `Artifact is ${incident.archive.toUpperCase()}; published to purchaser: ${incident.access === "unknown" ? "unknown" : String(incident.access === "published")}.`,
    },
    {
      id: stableId({ unit, source: "commerce" }),
      source: "commerce",
      unit_id: null,
      text: "For this decision, assess only the target unit's next delivery action. The contract requires valid original bytes and purchaser retrieval. Payment authority is separate.",
    },
  ];
  const baselineAction = baseline(incident);
  const start = performance.now();
  try {
    const result = await model.assess(evidence);
    const actions = result.assessment.actions.map((action) => ({
      kind: action.kind,
      unit_matches: action.unit_id === unit,
    }));
    const correct =
      actions.length === 1 &&
      actions[0]!.kind === expected &&
      actions[0]!.unit_matches;
    rows.push({
      id: incident.id,
      expected,
      baseline: baselineAction,
      baseline_correct: baselineAction === expected,
      ai_correct: correct,
      ai_actions: actions,
      disposition: result.assessment.disposition,
      unsupported_restore:
        expected !== "RESTORE_ACCESS" &&
        actions.some((action) => action.kind === "RESTORE_ACCESS"),
      literal_citations_passed: true,
      model: result.model,
      latency_ms: Math.round(performance.now() - start),
    });
  } catch {
    rows.push({
      id: incident.id,
      expected,
      baseline: baselineAction,
      baseline_correct: baselineAction === expected,
      ai_correct: false,
      status: "provider_or_validation_error",
      latency_ms: Math.round(performance.now() - start),
    });
  }
  console.log(JSON.stringify(rows.at(-1)));
  await delay(3200);
}
const report = {
  at: new Date().toISOString(),
  fixture_sha256: fixtureSha256,
  cases: rows.length,
  provenance: "actual Gemini, frozen synthetic incidents, automated scoring",
  baseline_correct: rows.filter((row) => row.baseline_correct).length,
  ai_correct: rows.filter((row) => row.ai_correct).length,
  ai_unavailable_or_invalid: rows.filter((row) => row.status).length,
  unsupported_restore: rows.filter((row) => row.unsupported_restore).length,
  limitations: [
    "Synthetic authored cases, no merchant data",
    "Exact single target action scored",
    "Both arms receive the same snapshot facts; no live tool calls",
    "Literal citation validation is not human semantic grading",
    "Operator time and cost benefit unmeasured",
    "No monetary writes",
  ],
  results: rows,
};
await writeFile(
  "evidence/investigation-evaluation.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    cases: report.cases,
    baseline_correct: report.baseline_correct,
    ai_correct: report.ai_correct,
    invalid: report.ai_unavailable_or_invalid,
    unsupported_restore: report.unsupported_restore,
  }),
);
