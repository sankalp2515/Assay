// Real KERNEL adapter check: a cloud Chromium fetches a public CC0 H.264 clip, hashes the
// bytes it received, and plays it, with a session replay. This proves the probe mechanism
// on KERNEL. It is not an Assay artifact: the hosted buyer route is not deployed yet.
//   npx tsx scripts/check-kernel-playback.ts
import "./config.js";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { KernelProber } from "../src/adapters/kernel.js";

const origin = process.env.KERNEL_CHECK_ORIGIN ?? "https://interactive-examples.mdn.mozilla.net";
const path = process.env.KERNEL_CHECK_PATH ?? "/media/cc0-videos/flower.mp4";
const local = await fetch(origin + path, { signal: AbortSignal.timeout(30000) });
if (!local.ok) throw new Error("Public test clip unavailable: " + local.status);
const expected = createHash("sha256").update(Buffer.from(await local.arrayBuffer())).digest("hex");

const prober = new KernelProber(process.env.KERNEL_API_KEY ?? "");
if (!prober.available) throw new Error("Set KERNEL_API_KEY in backend/.env");
const started = Date.now();
const result = await prober.probe({ pageUrl: origin + "/", contentUrl: origin + path, expectedSha256: expected });
const evidence = {
  at: new Date().toISOString(),
  kind: "real KERNEL cloud browser; public CC0 test clip, not an Assay artifact",
  clip: origin + path,
  expected_sha256: expected,
  outcome: result.outcome,
  digest_matches: result.sha256 === expected,
  bytes: result.bytes,
  played_to_seconds: result.current_time,
  duration_seconds: result.duration,
  resolution: result.width && result.height ? `${result.width}x${result.height}` : null,
  replay_recorded: !!result.replay_id,
  elapsed_ms: Date.now() - started,
  browser: result.browser,
  error: result.error,
};
await writeFile("evidence/kernel-playback.json", JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence, null, 2));
