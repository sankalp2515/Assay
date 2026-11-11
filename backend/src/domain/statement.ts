import { CompactSign, compactVerify, decodeProtectedHeader, importPKCS8, importSPKI } from "jose";
import type { Identity } from "../core/auth.js";
import { digest, type Json } from "./contracts.js";

// A per-clip delivery statement: what was delivered, what was charged, what was never taken.
// Built from the exact permit and purchaser-retrieval receipts that authorized the PayPal call.
export type Statement = {
  type: "delivery-statement";
  version: 1;
  batch_id: string;
  permit_id: string;
  contract_hash: string;
  assessment_id: string;
  currency: "USD";
  authorized_minor: number;
  charged_minor: number;
  not_taken_minor: number;
  clips: {
    clip: number;
    unit_id: string;
    price_minor: number;
    charged: boolean;
    sha256: string | null;
    retrieval_receipt_id: string | null;
  }[];
};

export const STATEMENT_TYP = "delivery-statement+jws";

export function deliveryStatement(input: {
  batch_id: string;
  permit_id: string;
  contract_hash: string;
  assessment_id: string;
  ceiling_minor: number;
  units: { id: string; price_minor: number }[];
  billed: string[];
  receipts: Json[];
}): Statement {
  const clips = input.units.map((u, i) => {
    const receipt = input.receipts.find((r) => r.unit_id === u.id);
    const charged = input.billed.includes(u.id);
    return {
      clip: i + 1,
      unit_id: u.id,
      price_minor: u.price_minor,
      charged,
      sha256: charged && receipt ? String(receipt.sha256) : null,
      retrieval_receipt_id: charged && receipt ? String(receipt.id) : null,
    };
  });
  const charged = clips
    .filter((c) => c.charged)
    .reduce((sum, c) => sum + c.price_minor, 0);
  return {
    type: "delivery-statement",
    version: 1,
    batch_id: input.batch_id,
    permit_id: input.permit_id,
    contract_hash: input.contract_hash,
    assessment_id: input.assessment_id,
    currency: "USD",
    authorized_minor: input.ceiling_minor,
    charged_minor: charged,
    not_taken_minor: input.ceiling_minor - charged,
    clips,
  };
}

const usd = (minor: number) => "$" + (minor / 100).toFixed(2);

// Shown to the buyer inside their PayPal transaction (note_to_payer, 255 characters max).
export function statementNote(s: Statement, statementDigest: string) {
  const delivered = s.clips.filter((c) => c.charged).length;
  return (
    `Charged ${usd(s.charged_minor)} for ${delivered} of ${s.clips.length} clips delivered. ` +
    `${usd(s.not_taken_minor)} of your ${usd(s.authorized_minor)} authorization was not taken. ` +
    `Statement ${statementDigest.slice(0, 16)}`
  ).slice(0, 255);
}

// The payload deliberately has no JWT audience, tenant or time claims, and a distinct typ,
// so a statement can never be accepted as a service bearer token.
export async function signStatement(identity: Identity, statement: Json) {
  return new CompactSign(new TextEncoder().encode(JSON.stringify(statement)))
    .setProtectedHeader({
      alg: "EdDSA",
      typ: STATEMENT_TYP,
      kid: identity.keyId ?? identity.name,
    })
    .sign(await importPKCS8(identity.privateKey, "EdDSA"));
}

export function statementKeys(identity: Identity) {
  if (identity.verificationKeys)
    return Object.entries(identity.verificationKeys)
      .filter(([, v]) => v.issuer === "payments")
      .map(([kid, v]) => ({ kid, pem: v.pem }));
  return identity.publicKeys.payments
    ? [{ kid: "payments", pem: identity.publicKeys.payments }]
    : [];
}

export async function verifyStatement(identity: Identity, jws: string) {
  try {
    const header = decodeProtectedHeader(jws);
    if (header.typ !== STATEMENT_TYP || header.alg !== "EdDSA")
      return { valid: false as const };
    const key = statementKeys(identity).find((k) => k.kid === header.kid);
    if (!key) return { valid: false as const };
    const { payload } = await compactVerify(
      jws,
      await importSPKI(key.pem, "EdDSA"),
    );
    const statement = JSON.parse(new TextDecoder().decode(payload)) as Json;
    if (statement.type !== "delivery-statement")
      return { valid: false as const };
    return {
      valid: true as const,
      statement,
      statement_digest: digest(statement),
      signed_by: "payments",
      kid: key.kid,
    };
  } catch {
    return { valid: false as const };
  }
}
