import { readFile, writeFile, mkdir } from "node:fs/promises";
import { services } from "../src/domain/contracts.js";
import { token } from "../src/core/auth.js";
const demo = JSON.parse(await readFile(".local/demo.json", "utf8")) as {
  tenant_id: string;
  operator_id: string;
  buyer_id: string;
};
const identity = {
  name: "operator",
  privateKey: await readFile(".local/keys/operator.pem", "utf8"),
  publicKeys: JSON.parse(
    await readFile(".local/public-keys.json", "utf8"),
  ) as Record<string, string>,
};
const access = await token(
  identity,
  "commerce",
  demo.tenant_id,
  "operator",
  demo.operator_id,
);
const ready = [];
for (const [i, service] of services.entries()) {
  const response = await fetch("http://127.0.0.1:" + (4100 + i) + "/ready", {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(service + " not ready");
  ready.push({ service, ...((await response.json()) as object) });
}
const url = "http://127.0.0.1:4100";
const input = {
  buyer_id: demo.buyer_id,
  unit_count: 1,
  unit_price_minor: 500,
  currency: "USD",
  prompt: "Synthetic HTTP smoke test, never submit to generation",
};
async function create(body: object) {
  return fetch(url + "/v1/batches", {
    method: "POST",
    headers: {
      authorization: "Bearer " + access,
      "content-type": "application/json",
      "idempotency-key": "persistent-http-smoke-v1",
    },
    body: JSON.stringify(body),
  });
}
const a = await create(input);
if (!a.ok) throw new Error("Authenticated create failed");
const first = (await a.json()) as { id: string };
const b = await create(input);
const retry = (await b.json()) as { id: string };
if (first.id !== retry.id) throw new Error("Idempotency failed");
let prior: string | undefined;
try {
  prior = (
    JSON.parse(await readFile(".local/http-smoke-reference.json", "utf8")) as {
      id: string;
    }
  ).id;
} catch {}
if (prior && prior !== first.id)
  throw new Error("Previously committed smoke batch did not survive restart");
await writeFile(
  ".local/http-smoke-reference.json",
  JSON.stringify({ id: first.id }),
);
if ((await create({ ...input, unit_price_minor: 600 })).status !== 409)
  throw new Error("Changed payload accepted");
if ((await fetch(url + "/v1/batches")).status !== 401)
  throw new Error("Unauthenticated data access accepted");
await mkdir("evidence", { recursive: true });
await writeFile(
  "evidence/http-smoke.json",
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      transport: "HTTP between five separately launched local processes",
      ready,
      idempotent_create: true,
      previously_committed_reference_preserved: !!prior,
      changed_payload_rejected: true,
      unauthenticated_access_rejected: true,
      paypal_transaction: false,
      provider_generation: false,
    },
    null,
    2,
  ),
);
await writeFile(
  ".local/postman.environment.json",
  JSON.stringify({
    name: "Private local smoke environment",
    values: [
      { key: "operator_token", value: access, enabled: true },
      { key: "commerce_url", value: url, enabled: true },
    ],
  }),
  { mode: 0o600 },
);
console.log(
  "Five services ready. HTTP create/replay/conflict/auth checks passed. Private short-lived Postman token prepared.",
);
