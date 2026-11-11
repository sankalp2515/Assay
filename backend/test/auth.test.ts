import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { authenticate, token, type Identity } from "../src/core/auth.js";
import { id } from "../src/domain/contracts.js";
function pair() {
  const result = generateKeyPairSync("ed25519");
  return {
    privateKey: result.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    pem: result.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}
test("overlap rotation accepts both operator keys then rejects retired key without changing issuer", async () => {
  const old = pair(),
    next = pair();
  const verifier: Identity = {
    name: "commerce",
    privateKey: "unused",
    publicKeys: { operator: old.pem },
    verificationKeys: {
      "operator-v1": { issuer: "operator", pem: old.pem },
      "operator-v2": { issuer: "operator", pem: next.pem },
    },
  };
  const tenant = id();
  const issuer = (keyId: string, privateKey: string): Identity => ({
    name: "operator",
    keyId,
    privateKey,
    publicKeys: {},
  });
  const oldToken = await token(
    issuer("operator-v1", old.privateKey),
    "commerce",
    tenant,
    "operator",
  );
  const nextToken = await token(
    issuer("operator-v2", next.privateKey),
    "commerce",
    tenant,
    "operator",
  );
  assert.equal(
    (await authenticate("Bearer " + oldToken, verifier, "commerce")).issuer,
    "operator",
  );
  assert.equal(
    (await authenticate("Bearer " + nextToken, verifier, "commerce")).issuer,
    "operator",
  );
  delete verifier.verificationKeys!["operator-v1"];
  await assert.rejects(
    authenticate("Bearer " + oldToken, verifier, "commerce"),
  );
  assert.equal(
    (await authenticate("Bearer " + nextToken, verifier, "commerce")).issuer,
    "operator",
  );
  const impersonation = await token(
    { ...issuer("operator-v2", next.privateKey), name: "payments" },
    "commerce",
    tenant,
  );
  await assert.rejects(
    authenticate("Bearer " + impersonation, verifier, "commerce"),
  );
});
