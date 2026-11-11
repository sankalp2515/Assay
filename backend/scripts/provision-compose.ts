import "./config.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { services } from "../src/domain/contracts.js";
// Docker Compose and dotenv disagree on escapes inside double quotes: compose keeps \"
// literally. A value containing a double quote (the JSON key list) is written single-quoted,
// which every reader takes literally. Everything else is JSON-quoted, so PEM newlines are \n.
function envLine(key: string, value: string) {
  if (value.includes('"')) {
    if (value.includes("'") || /[\r\n]/.test(value))
      throw new Error("Cannot safely encode " + key);
    return key + "='" + value + "'";
  }
  return key + "=" + JSON.stringify(value);
}
// Reads both the current format and the earlier all-JSON-quoted format, so values are kept.
function readEnv(text: string) {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const raw = m[2]!;
    out[m[1]!] = raw.startsWith("'")
      ? raw.slice(1, -1)
      : raw.startsWith('"')
        ? (JSON.parse(raw) as string)
        : raw;
  }
  return out;
}
const publicKeys = JSON.parse(
  await readFile(".local/public-keys.json", "utf8"),
) as Record<string, string>;
let existing: Record<string, string> | undefined;
try {
  existing = readEnv(await readFile(".local/compose.env", "utf8"));
  if (
    !process.argv.includes("--refresh-schema") &&
    !process.argv.includes("--sync-integrations")
  )
    throw new Error(
      "Compose credentials exist. Use --refresh-schema to update initialization SQL without rotating credentials.",
    );
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
const demo = JSON.parse(await readFile(".local/demo.json", "utf8")) as {
  tenant_id: string;
  operator_id?: string;
  buyer_id?: string;
};
const env: Record<string, string> = existing ?? {
  PUBLIC_KEYS: JSON.stringify(publicKeys),
  TENANT_ID: demo.tenant_id,
  MEDIA_VERIFIER_TOKEN: randomBytes(32).toString("hex"),
};
if (!existing) {
  for (const service of services) {
    const upper = service.toUpperCase();
    env[upper + "_PRIVATE_KEY"] = await readFile(
      ".local/keys/" + service + ".pem",
      "utf8",
    );
    env[upper + "_DB_PASSWORD"] = randomBytes(24).toString("hex");
    env[upper + "_RUNTIME_PASSWORD"] = randomBytes(24).toString("hex");
  }
}
if (!existing || process.argv.includes("--sync-integrations")) {
  for (const key of [
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "AI_FALLBACK_PROVIDERS",
    "AI_ZERO_COST_ONLY",
    "GEMINI_FREE_TIER_CONFIRMED",
    "GROQ_FREE_TIER_CONFIRMED",
    "NVIDIA_FREE_TIER_CONFIRMED",
    "GROQ_API_KEY",
    "GROQ_MODEL",
    "NVIDIA_API_KEY",
    "NVIDIA_MODEL",
    "PAYPAL_CLIENT_ID",
    "PAYPAL_CLIENT_SECRET",
    "PAYPAL_MERCHANT_ID",
    "PAYPAL_WEBHOOK_ID",
    "PAYPAL_RETURN_URL",
    "PAYPAL_CANCEL_URL",
    "RUNWAY_API_KEY",
    "RUNWAY_MODEL",
    "RUNWAY_ALLOWED_HOSTS",
    "REPLICATE_API_TOKEN",
    "REPLICATE_ALLOWED_HOSTS",
    "REPORTED_OUTPUT_HOSTS",
    "APPROVAL_WINDOW_SECONDS",
    "BUYER_RETURN_BASE",
    "SIGNUP_MODE",
    "SIGNUP_INVITE_CODE",
    "PAYPAL_PARTNER_MODE",
    "PAYPAL_PARTNER_ATTRIBUTION_ID",
    "ARTIFACT_STORE",
    "GCS_BUCKET",
    "GCS_PREFIX",
    "KERNEL_API_KEY",
    "PLAYBACK_PROBE_ORIGIN",
    "KERNEL_MAX_PROBES_PER_DAY",
    "AI_PRIMARY",
    "VERTEX_PROJECT",
    "VERTEX_LOCATION",
    "VERTEX_MODEL",
    "VERTEX_CREDITS_CONFIRMED",
    "MERCHANT_WEBHOOK_URL",
    "MERCHANT_WEBHOOK_SECRET",
  ])
    if (process.env[key] !== undefined) env[key] = process.env[key]!;

}
// The hosted web gateway (infra/gcp) keeps sessions in its own database and signs as
// "operator". Credentials are added once and kept on later runs.
env.WEB_DB_PASSWORD ??= randomBytes(24).toString("hex");
env.WEB_RUNTIME_PASSWORD ??= randomBytes(24).toString("hex");
env.WEB_PRIVATE_KEY ??= await readFile(".local/keys/operator.pem", "utf8").catch(() => "");
// Demo members for the hosted Sandbox's "Try as merchant / as buyer" sign-in.
if (demo.operator_id && demo.buyer_id)
  env.WEB_MEMBERS_JSON ??= JSON.stringify({
    "demo-operator": { role: "operator", subject: demo.operator_id, name: "Demo merchant" },
    "demo-buyer": { role: "buyer", subject: demo.buyer_id, name: "Demo buyer" },
  });
// The key list is public and derived; rebuild it so an earlier mis-escaped copy can't persist.
env.PUBLIC_KEYS = JSON.stringify(publicKeys);
for (const service of services) {
  const pem = env[service.toUpperCase() + "_PRIVATE_KEY"] ?? "";
  if (!pem.startsWith("-----BEGIN") || !pem.includes(String.fromCharCode(10)))
    throw new Error(service + " private key is not a PEM after decoding; re-provision keys");
}
await writeFile(
  ".local/compose.env",
  Object.entries(env)
    .map(([k, v]) => envLine(k, v))
    .join("\n") + "\n",
  { mode: 0o600 },
);
await mkdir(".local/init", { recursive: true, mode: 0o700 });
const core = await readFile("migrations/001_core.sql", "utf8");
const payment = await readFile("migrations/002_payments.sql", "utf8");
const operations = await readFile("migrations/003_operations.sql", "utf8");
const currencies = await readFile("migrations/004_currencies.sql", "utf8");
for (const service of services) {
  const password = env[service.toUpperCase() + "_RUNTIME_PASSWORD"]!;
  const sql =
    core +
    (service === "payments" ? "\n" + payment + "\n" + currencies : "") +
    "\n" +
    operations +
    `\nCREATE ROLE runtime LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOINHERIT;\nGRANT app_runtime TO runtime;\nREVOKE CREATE ON SCHEMA public FROM PUBLIC;\nREVOKE CONNECT ON DATABASE ${service} FROM PUBLIC;\nGRANT CONNECT ON DATABASE ${service} TO runtime;\n` +
    (service === "provider" || service === "delivery"
      ? "CREATE UNIQUE INDEX entities_unit_once_idx ON entities(tenant_id,kind,(body->>'unit_id')) WHERE kind IN ('attempt','artifact');\n"
      : "");
  await writeFile(".local/init/" + service + ".sql", sql, { mode: 0o600 });
}
await writeFile(
  ".local/init/web.sql",
  core +
    "\n" +
    operations +
    `
CREATE ROLE runtime LOGIN PASSWORD '${env.WEB_RUNTIME_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT app_runtime TO runtime;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CONNECT ON DATABASE web FROM PUBLIC;
GRANT CONNECT ON DATABASE web TO runtime;
`,
  { mode: 0o600 },
);
console.log(
  "Wrote private configuration and database initialization SQL. Database/service credentials preserved; external integrations change only with explicit --sync-integrations.",
);
