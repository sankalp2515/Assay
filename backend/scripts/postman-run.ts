// Runs the Assay merchant collection headless (Newman) against the five services in this
// process: fixture PayPal and fixture AI, real HTTP on a local port. Folders 0-3 and 5 run
// end to end; folder 4's settle steps need a real Sandbox approval and archived clips, so
// their tests only assert when the step applies.
//   npm run postman:run          (or BASE_URL=https://<hosted> to run against a deployment)
import { writeFile } from "node:fs/promises";
import newman from "newman";
import { harness } from "../test/harness.js";
import { merchantCollection, environment } from "./postman.js";

const external = process.env.BASE_URL;
let close = async () => {};
let baseUrl = external ?? "";
if (!external) {
  process.env.SIGNUP_MODE = "open";
  process.env.PAYPAL_CLIENT_ID ??= "SANDBOX_CLIENT_ID_PLACEHOLDER";
  const h = await harness();
  await h.apps.commerce.listen({ host: "127.0.0.1", port: 0 });
  const address = h.apps.commerce.server.address();
  baseUrl = "http://127.0.0.1:" + (typeof address === "object" && address ? address.port : 0);
  close = () => h.close();
}
try {
  const summary = await new Promise<newman.NewmanRunSummary>((resolve, reject) =>
    newman.run(
      {
        collection: merchantCollection() as never,
        environment: environment("run", baseUrl) as never,
        reporters: ["cli"],
        envVar: process.env.INVITE_CODE ? [{ key: "invite_code", value: process.env.INVITE_CODE }] : [],
      },
      (err, s) => (err ? reject(err) : resolve(s)),
    ),
  );
  const stats = summary.run.stats;
  const failures = summary.run.failures.map((f) => ({
    item: f.source?.name ?? null,
    test: (f.error as { test?: string }).test ?? null,
    message: f.error.message,
  }));
  const evidence = {
    at: new Date().toISOString(),
    target: external ? "external deployment" : "in-process services, fixture PayPal and AI, local HTTP",
    requests: stats.requests.total,
    assertions: stats.assertions.total,
    assertions_failed: stats.assertions.failed,
    failures,
  };
  if (!external) await writeFile("evidence/postman-run.json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
  if ((stats.assertions.failed ?? 0) > 0) process.exitCode = 1;
} finally {
  await close();
}
