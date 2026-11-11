import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { services } from "../src/domain/contracts.js";
await mkdir(".local/keys", { recursive: true, mode: 0o700 });
const publicKeys: Record<string, string> = {};
for (const name of [...services, "operator"]) {
  try {
    publicKeys[name] = await readFile(".local/keys/" + name + ".pub", "utf8");
  } catch {
    const pair = generateKeyPairSync("ed25519");
    const pub = pair.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    const priv = pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    await writeFile(".local/keys/" + name + ".pem", priv, { mode: 0o600 });
    await writeFile(".local/keys/" + name + ".pub", pub);
    publicKeys[name] = pub;
  }
}
await writeFile(".local/public-keys.json", JSON.stringify(publicKeys, null, 2));
try {
  await readFile(".local/demo.json");
} catch {
  await writeFile(
    ".local/demo.json",
    JSON.stringify(
      {
        tenant_id: randomUUID(),
        operator_id: randomUUID(),
        buyer_id: randomUUID(),
      },
      null,
      2,
    ),
  );
}
console.log(
  "Provisioned local service identities and demo tenant. Private keys stay in .local/keys.",
);
