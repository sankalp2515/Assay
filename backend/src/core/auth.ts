import {
  importPKCS8,
  importSPKI,
  SignJWT,
  jwtVerify,
  type JWTPayload,
} from "jose";
import { createHash } from "node:crypto";
import { Problem, requireThat } from "./errors.js";
import type { Service, Json } from "../domain/contracts.js";
export type Identity = {
  name: string;
  privateKey: string;
  publicKeys: Record<string, string>;
  keyId?: string;
  verificationKeys?: Record<string, { issuer: string; pem: string }>;
};
export type Actor = {
  tenant: string;
  subject: string;
  issuer: string;
  role: string;
  environment: string;
};
export async function token(
  identity: Identity,
  audience: string,
  tenant: string,
  role = "service",
  subject = identity.name,
  extra: Json = {},
) {
  return new SignJWT({ tenant, role, environment: "sandbox", ...extra })
    .setProtectedHeader({ alg: "EdDSA", kid: identity.keyId ?? identity.name })
    .setIssuer(identity.name)
    .setSubject(subject)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(await importPKCS8(identity.privateKey, "EdDSA"));
}
export async function authenticate(
  header: string | undefined,
  identity: Identity,
  audience: Service,
): Promise<Actor> {
  if (!header?.startsWith("Bearer "))
    throw new Problem(401, "unauthorized", "A bearer token is required");
  try {
    let selectedIssuer: string | undefined;
    const { payload } = await jwtVerify(
      header.slice(7),
      async (h) => {
        const keyId = h.kid ?? "";
        const registered = identity.verificationKeys?.[keyId];
        const pem = identity.verificationKeys
          ? registered?.pem
          : identity.publicKeys[keyId];
        if (!pem) throw new Error("unknown issuer");
        selectedIssuer = identity.verificationKeys ? registered!.issuer : keyId;
        return importSPKI(pem, "EdDSA");
      },
      { audience, algorithms: ["EdDSA"], maxTokenAge: "2m", clockTolerance: 3 },
    );
    const p = payload as JWTPayload & {
      tenant?: unknown;
      role?: unknown;
      environment?: unknown;
    };
    requireThat(
      typeof p.tenant === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          p.tenant,
        ),
      "unauthorized",
      "Invalid tenant",
      401,
    );
    requireThat(
      p.environment === "sandbox" &&
        typeof p.sub === "string" &&
        typeof p.iss === "string" &&
        typeof p.role === "string",
      "unauthorized",
      "Invalid identity",
      401,
    );
    requireThat(
      p.iss === selectedIssuer,
      "unauthorized",
      "Invalid issuer",
      401,
    );
    return {
      tenant: p.tenant,
      subject: p.sub!,
      issuer: p.iss,
      role: p.role,
      environment: "sandbox",
    };
  } catch {
    throw new Problem(401, "unauthorized", "Invalid or expired token");
  }
}
export function authorize(
  actor: Actor,
  issuers: readonly string[],
  roles?: readonly string[],
) {
  requireThat(
    issuers.includes(actor.issuer) && (!roles || roles.includes(actor.role)),
    "forbidden",
    "This identity cannot perform this operation",
    403,
  );
}
export const fingerprint = (value: string) =>
  createHash("sha256").update(value).digest("hex");
