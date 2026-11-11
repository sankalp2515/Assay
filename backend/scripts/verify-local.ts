import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
const run = promisify(execFile);
const steps = [
  { name: "typecheck", args: ["node_modules/typescript/bin/tsc", "--noEmit"] },
  {
    name: "tests",
    args: [
      "node_modules/tsx/dist/cli.mjs",
      "--test",
      ...(await readdir("test"))
        .filter((f) => f.endsWith(".test.ts"))
        .map((f) => "test/" + f),
    ],
  },
  {
    name: "native-postgres",
    args: ["--import", "tsx", "scripts/check-postgres.ts"],
  },
  {
    name: "build",
    args: ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"],
  },
  { name: "openapi", args: ["--import", "tsx", "scripts/export-api.ts"] },
];
await mkdir(".local", { recursive: true });
await mkdir("evidence", { recursive: true });
const results = [];
let failed = false;
for (const step of steps) {
  const start = Date.now();
  try {
    const result = await run(process.execPath, step.args, {
      windowsHide: true,
      timeout: 600000,
      maxBuffer: 4 * 1024 * 1024,
    });
    await writeFile(
      ".local/verify-" + step.name + ".log",
      result.stdout + result.stderr,
      { mode: 0o600 },
    );
    const counts =
      step.name === "tests"
        ? {
            tests: Number(result.stdout.match(/# tests (\d+)/)?.[1]),
            tests_passed: Number(result.stdout.match(/# pass (\d+)/)?.[1]),
            failed: Number(result.stdout.match(/# fail (\d+)/)?.[1]),
          }
        : {};
    results.push({
      step: step.name,
      passed: true,
      elapsed_ms: Date.now() - start,
      ...counts,
    });
    console.log(JSON.stringify(results.at(-1)));
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    await writeFile(
      ".local/verify-" + step.name + ".log",
      (e.stdout ?? "") + (e.stderr ?? ""),
      { mode: 0o600 },
    );
    results.push({
      step: step.name,
      passed: false,
      elapsed_ms: Date.now() - start,
    });
    failed = true;
    break;
  }
}
const native = results.some((r) => r.step === "native-postgres" && r.passed)
  ? JSON.parse(await readFile("evidence/native-postgres.json", "utf8"))
  : undefined;
await writeFile(
  "evidence/local-quality.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      passed: !failed,
      results,
      native_database_checks: native?.passed ?? 0,
      external_api_calls: false,
      limitations: [
        "fixture-based domain/API tests",
        "no actual video-provider generation",
        "PayPal and external AI receipts are separate gates",
        "no commercial production or cloud capacity certification",
      ],
    },
    null,
    2,
  ),
);
if (failed) {
  console.error("Local verification failed; see private .local/verify-*.log");
  process.exitCode = 1;
}
