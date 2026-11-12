import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { embedded, postgres } from "../src/core/database.js";
import { createGateway, type Member } from "../src/web/gateway.js";
import { oidcProvider } from "../src/web/oidc.js";
const env = process.env;
const demoLogin = env.WEB_DEMO_LOGIN === "true";
for (const key of [
  "WEB_ORIGIN",
  "WEB_TENANT_ID",
  "WEB_MEMBERS_JSON",
  ...(demoLogin
    ? []
    : [
        "WEB_OIDC_ISSUER",
        "WEB_OIDC_CLIENT_ID",
        "WEB_OIDC_CLIENT_SECRET",
        "WEB_OIDC_AUTHORIZATION_ENDPOINT",
        "WEB_OIDC_TOKEN_ENDPOINT",
        "WEB_OIDC_JWKS_URI",
      ]),
])
  if (!env[key])
    throw Error(`Configure ${key} privately before starting the web gateway`);
const local = env.WEB_LOCAL_ONLY === "true";
if (!local && !env.WEB_DATABASE_URL)
  throw Error(
    "Production-shaped web gateway requires its own PostgreSQL database",
  );
const db = env.WEB_DATABASE_URL
  ? postgres(env.WEB_DATABASE_URL)
  : await embedded(resolve(".local/web-data"));
if(local) await db.migrate("commerce");
const identity = {
  name: "operator",
  privateKey:
    env.WEB_PRIVATE_KEY || (await readFile(".local/keys/operator.pem", "utf8")),
  publicKeys: JSON.parse(
    env.PUBLIC_KEYS || (await readFile(".local/public-keys.json", "utf8")),
  ),
};
const origin = env.WEB_ORIGIN!;
const app = await createGateway({
  origin,
  tenant: env.WEB_TENANT_ID!,
  identity,
  db,
  localOnly: local,
  merchantName: env.WEB_MERCHANT_NAME,
  members: JSON.parse(env.WEB_MEMBERS_JSON!) as Record<string, Member>,
  assetsDir: resolve(env.WEB_ASSETS_DIR || "../frontend/dist/client"),
  commerceUrl: env.WEB_COMMERCE_URL || "http://127.0.0.1:4100",
  deliveryUrl: env.WEB_DELIVERY_URL || "http://127.0.0.1:4102",
  demoLogin,
  trustProxy: env.WEB_TRUST_PROXY === "true",
  sso: Boolean(env.WEB_OIDC_ISSUER),
  login: demoLogin && !env.WEB_OIDC_ISSUER
    ? {
        authorization: () => origin + "/#/",
        exchange: async () => {
          throw Error("Identity provider not configured on this demo");
        },
      }
    : oidcProvider({
    issuer: env.WEB_OIDC_ISSUER!,
    clientId: env.WEB_OIDC_CLIENT_ID!,
    clientSecret: env.WEB_OIDC_CLIENT_SECRET!,
    authorizationEndpoint: env.WEB_OIDC_AUTHORIZATION_ENDPOINT!,
    tokenEndpoint: env.WEB_OIDC_TOKEN_ENDPOINT!,
    jwksUri: env.WEB_OIDC_JWKS_URI!,
    redirectUri: origin + "/api/callback",
  }),
});
await app.listen({
  host: local ? "127.0.0.1" : "0.0.0.0",
  port: Number(env.WEB_PORT || 4300),
});
for (const sig of ["SIGTERM", "SIGINT"] as const)
  process.once(sig, () => void app.close().then(() => db.close()));
console.log(
  "Web gateway ready; authentication and credentials stay server-side.",
);
