import "./config.js";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { ZodError } from "zod";
import { configuredInvestigator } from "../src/adapters/models.js";
import { GeminiInvestigator } from "../src/adapters/gemini.js";
import { Problem } from "../src/core/errors.js";
import { baselineRead, messageCases, pairs } from "../evaluation/buyer-messages.js";

// Held-out comparison on free-text buyer messages: actual Gemini versus a keyword baseline.
// Both arms see the same message. Scoring is exact (clip, issue) sets plus the instruction flag.
if (
  configuredInvestigator({ ...process.env, AI_ZERO_COST_ONLY: "true", AI_FALLBACK_PROVIDERS: "" })
    .available !== true ||
  process.env.GEMINI_FREE_TIER_CONFIRMED !== "true"
)
  throw new Error("Confirmed Gemini free-tier access is required");
// Called directly (not through the fallback chain) so a bad reading and an unavailable
// provider can be told apart. Only transport failures are retried; invalid readings count as wrong.
const model = new GeminiInvestigator(
  process.env.GEMINI_API_KEY ?? "",
  process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite",
  fetch,
  30000,
);
async function read(message: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return { result: await model.interpret(message, 10), attempts: attempt };
    } catch (error) {
      const invalid =
        error instanceof ZodError ||
        error instanceof SyntaxError ||
        (error instanceof Problem && error.code !== "integration_unavailable");
      if (invalid) return { invalid: true, attempts: attempt };
      if (attempt >= 4) return { unavailable: true, attempts: attempt };
      await delay(20000 * attempt);
    }
  }
}
const fixtureSha256 = createHash("sha256")
  .update(await readFile("evaluation/buyer-messages.ts"))
  .digest("hex");
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const clipsOf = (p: string[]) => [...new Set(p.map((x) => x.split(":")[0] ?? ""))].sort();
const rows: Record<string, unknown>[] = [];
for (const c of messageCases) {
  const expected = [...c.expected].sort();
  const base = baselineRead(c.message);
  const basePairs = pairs(base);
  const row: Record<string, unknown> = {
    id: c.id,
    note: c.note,
    expected,
    baseline: basePairs,
    baseline_exact: same(basePairs, expected) && base.contains_instructions === c.instructions,
    baseline_clips: same(clipsOf(basePairs), clipsOf(expected)),
  };
  const start = performance.now();
  const outcome = await read(c.message);
  row.attempts = outcome.attempts;
  if ("result" in outcome && outcome.result) {
    const result = outcome.result;
    const aiPairs = pairs(result.interpretation);
    Object.assign(row, {
      ai: aiPairs,
      ai_exact: same(aiPairs, expected) && result.interpretation.contains_instructions === c.instructions,
      ai_clips: same(clipsOf(aiPairs), clipsOf(expected)),
      ai_instruction_flag: result.interpretation.contains_instructions,
      literal_quotes_passed: true,
      model: result.model,
    });
  } else
    Object.assign(row, {
      ai_exact: false,
      ai_clips: false,
      status: "invalid" in outcome ? "invalid_reading" : "provider_unavailable",
    });
  row.latency_ms = Math.round(performance.now() - start);
  rows.push(row);
  console.log(JSON.stringify(row));
  await delay(6000);
}
const count = (k: string) => rows.filter((r) => r[k] === true).length;
const report = {
  at: new Date().toISOString(),
  fixture_sha256: fixtureSha256,
  cases: rows.length,
  provenance: "actual Gemini, frozen authored buyer messages, automated exact scoring",
  scoring: "exact set of (clip, issue) pairs and instruction flag; clip-only score ignores issue type",
  baseline: "keyword rules: digits, number words, ordinals, ranges, last-N, except/rest, issue keywords",
  baseline_exact: count("baseline_exact"),
  ai_exact: count("ai_exact"),
  baseline_clips: count("baseline_clips"),
  ai_clips: count("ai_clips"),
  answered_cases: rows.filter((r) => r.status !== "provider_unavailable").length,
  baseline_exact_on_answered: rows.filter((r) => r.status !== "provider_unavailable" && r.baseline_exact === true).length,
  ai_exact_on_answered: rows.filter((r) => r.status !== "provider_unavailable" && r.ai_exact === true).length,
  ai_invalid_reading: rows.filter((r) => r.status === "invalid_reading").length,
  ai_provider_unavailable: rows.filter((r) => r.status === "provider_unavailable").length,
  scoring_note:
    "Invalid readings (schema or quote validation failed) count as wrong. Provider-unavailable cases count as wrong in ai_exact and are listed separately.",
  limitations: [
    "Authored messages, not real customer tickets",
    "Single run at temperature 0; no variance estimate",
    "The model reads only; outcomes are decided by rules and are not part of this score",
    "No monetary writes",
  ],
  results: rows,
};
await writeFile("evidence/claim-reading-evaluation.json", JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    cases: report.cases,
    baseline_exact: report.baseline_exact,
    ai_exact: report.ai_exact,
    baseline_clips: report.baseline_clips,
    ai_clips: report.ai_clips,
    invalid: report.ai_invalid_reading,
    unavailable: report.ai_provider_unavailable,
  }),
);
