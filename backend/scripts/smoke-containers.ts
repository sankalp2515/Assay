// Smoke test for the Docker Compose topology: real containers, real PostgreSQL, signed
// service-to-service calls over the compose network. Makes no PayPal order and no paid
// generation. The buyer-message step may call the configured free-tier AI once.
//   COMMERCE_URL=http://127.0.0.1:14100 npm run smoke:containers
import { readFile, writeFile } from "node:fs/promises";
import { token } from "../src/core/auth.js";

const base = process.env.COMMERCE_URL ?? "http://127.0.0.1:4100";
const demo = JSON.parse(await readFile(".local/demo.json", "utf8")) as {
  tenant_id: string;
  operator_id: string;
  buyer_id: string;
};
const identity = {
  name: "operator",
  privateKey: await readFile(".local/keys/operator.pem", "utf8"),
  publicKeys: JSON.parse(await readFile(".local/public-keys.json", "utf8")) as Record<string, string>,
};
const bearer = async (role: "operator" | "buyer") =>
  "Bearer " +
  (await token(identity, "commerce", demo.tenant_id, role, role === "buyer" ? demo.buyer_id : demo.operator_id));
async function call(path: string, role: "operator" | "buyer", body?: object, key?: string) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: await bearer(role),
      ...(body ? { "content-type": "application/json", "idempotency-key": key ?? "smoke-" + crypto.randomUUID() } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60000),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}
const checks: Record<string, unknown> = {};
const must = (name: string, ok: boolean, detail?: unknown) => {
  checks[name] = detail ?? ok;
  if (!ok) throw new Error("Container smoke failed: " + name + " " + JSON.stringify(detail ?? ""));
};

const overview = await call("/v1/operations/overview", "operator");
must("all five services reachable through commerce", overview.status === 200, overview.status);

const key = "container-smoke-" + Date.now();
const input = {
  buyer_id: demo.buyer_id,
  unit_count: 3,
  unit_price_minor: 500,
  currency: "USD",
  prompt: "Container smoke test batch, never submitted to generation",
};
const created = await call("/v1/batches", "operator", input, key);
must("create batch in commerce database", created.status === 200, created.status);
const id = String(created.body.id);
const replay = await call("/v1/batches", "operator", input, key);
must("idempotent replay returns same batch", replay.body.id === id);
const conflict = await call("/v1/batches", "operator", { ...input, unit_price_minor: 600 }, key);
must("changed payload under same key rejected", conflict.status === 409, conflict.status);

const review = await call("/v1/batches/" + id + "/review", "operator");
must("commerce -> provider and delivery containers", review.status === 200, review.status);
const outcomes = await call("/v1/batches/" + id + "/outcomes", "buyer");
must("buyer read: commerce -> delivery and payments containers", outcomes.status === 200, outcomes.status);

const support = await call(
  "/v1/batches/" + id + "/support",
  "buyer",
  { category: "access", message: "The second clip never arrived" },
);
const reading = (support.body.reading ?? {}) as Record<string, unknown>;
must(
  "buyer message: commerce -> investigation (AI read or safely queued)",
  support.status === 200 && ["READ", "WAITING_FOR_AI", "MERCHANT_QUEUE"].includes(String(reading.state)),
  { status: support.status, reading_state: reading.state, model: reading.model ?? null },
);

const keys = await fetch(base + "/v1/statements/keys");
must("public statement key published", keys.ok && ((await keys.json()) as { keys: unknown[] }).keys.length > 0);
const anonymous = await fetch(base + "/v1/batches");
must("unauthenticated access rejected", anonymous.status === 401, anonymous.status);
const otherTenant = await fetch(base + "/v1/batches/" + id, {
  headers: {
    authorization:
      "Bearer " + (await token(identity, "commerce", "00000000-0000-4000-a000-0000000000ff", "operator", demo.operator_id)),
  },
});
must("other tenant cannot read the batch", otherTenant.status === 401 || otherTenant.status === 404, otherTenant.status);

await writeFile(
  "evidence/container-smoke.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      topology: "docker compose: 5 service containers, 5 PostgreSQL 18 containers, isolated verifier",
      transport: "HTTP over the compose network with signed Ed25519 service tokens",
      paypal_transaction: false,
      provider_generation: false,
      checks,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify(checks, null, 2));
