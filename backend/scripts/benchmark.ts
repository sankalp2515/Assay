import { harness } from "../test/harness.js";
import { mkdir, writeFile } from "node:fs/promises";
const h = await harness();
try {
  const samples: number[] = [];
  const count = 50;
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    const r = await h.request("/v1/batches");
    if (r.statusCode !== 200) throw new Error("Benchmark request failed");
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const report = {
    timestamp: new Date().toISOString(),
    environment:
      "single process Fastify injection + five isolated embedded PostgreSQL engines, empty batch list, JWT auth",
    requests: count,
    p50_ms: samples[Math.floor(count * 0.5)],
    p95_ms: samples[Math.floor(count * 0.95)],
    external_provider_requests: 0,
    scope:
      "bounded local API microbenchmark, not distributed load/capacity validation",
  };
  await mkdir("evidence", { recursive: true });
  await writeFile("evidence/benchmark.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await h.close();
}
