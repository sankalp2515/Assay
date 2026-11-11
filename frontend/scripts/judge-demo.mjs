#!/usr/bin/env node
// One-command local walkthrough: fixture backend + UI on loopback.
// Fixture AI, fixture PayPal and a labeled synthetic clip. No keys, network or money.
// Usage: npm run demo:ui [-- recovery|partial|partial-recovery|zero] [--real-ai] [--sandbox] [--no-backend] [--port 5180]
// --sandbox uses REAL PayPal Sandbox and a real hosted model (needs backend/.env); media is still seeded.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = path.resolve(root, "../backend");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const scenario =
  args.find((a) =>
    ["recovery", "partial", "partial-recovery", "zero"].includes(a),
  ) || "partial-recovery";
const commercePort = Number(process.env.FIXTURE_COMMERCE_PORT || 4300);
const deliveryPort = Number(process.env.FIXTURE_DELIVERY_PORT || 4302);
const uiPort = Number(option("--port", 5180));

let child;
function stop() {
  if (child && !child.killed) child.kill();
}
process.once("SIGINT", () => {
  stop();
  process.exit(0);
});
process.once("SIGTERM", () => {
  stop();
  process.exit(0);
});
process.once("exit", stop);

async function startBackend() {
  if (!existsSync(path.join(backend, ".local", "demo.json")))
    throw new Error(
      "Local identities are missing. Run `npm ci && npm run provision` in backend/ first.",
    );
  const clip = path.join(root, "demo", "synthetic-test-clip.mp4");
  child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      flag("--sandbox") ? "scripts/frontend-sandbox.ts" : "scripts/frontend-fixtures.ts",
      scenario,
      ...(flag("--real-ai") ? ["--real-ai"] : []),
    ],
    {
      cwd: backend,
      env: {
        ...process.env,
        FIXTURE_COMMERCE_PORT: String(commercePort),
        FIXTURE_DELIVERY_PORT: String(deliveryPort),
        ...(existsSync(clip) ? { FIXTURE_SOURCE_MP4: clip } : {}),
      },
      stdio: ["ignore", "pipe", "inherit"],
      windowsHide: true,
    },
  );
  let out = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Fixture backend did not start within 90 s.")),
      90000,
    );
    child.stdout.on("data", (chunk) => {
      out += chunk;
      const match = out.match(/"batch_id":\s*"([0-9a-f-]+)"/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Fixture backend exited (${code}). ${out.slice(-400)}`));
    });
  });
}

try {
  const batch = flag("--no-backend") ? null : await startBackend();
  process.env.PVD_COMMERCE_URL = `http://127.0.0.1:${commercePort}`;
  process.env.PVD_DELIVERY_URL = `http://127.0.0.1:${deliveryPort}`;
  // Open on the connected services rather than the in-browser walkthrough.
  process.env.VITE_DEFAULT_MODE = "backend";
  const server = await createServer({
    root,
    server: { port: uiPort, strictPort: false },
  });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0] || `http://127.0.0.1:${uiPort}/`;
  console.log(
    [
      "",
      "  Outcome assurance walkthrough is running.",
      `  Scenario: ${scenario} · AI: ${flag("--real-ai") ? "hosted model over fixture observations" : "deterministic fixture"} · PayPal: fixture · Media: synthetic test clip`,
      `  Open  ${url}`,
      batch ? `  Case  ${url}#/batches/${batch}` : "",
      "  Loopback only. Never expose this server publicly.",
      "",
    ]
      .filter((line) => line !== "")
      .join("\n"),
  );
} catch (error) {
  console.error(error.message || error);
  stop();
  process.exit(1);
}
