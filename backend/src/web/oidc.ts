import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
export interface LoginProvider {
  authorization(state: string, nonce: string, verifier: string): string;
  exchange(code: string, nonce: string, verifier: string): Promise<string>;
}
export function oidcProvider(config: {
  issuer: string;
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  redirectUri: string;
}): LoginProvider {
  for (const value of [
    config.issuer,
    config.authorizationEndpoint,
    config.tokenEndpoint,
    config.jwksUri,
  ])
    if (new URL(value).protocol !== "https:")
      throw Error("OIDC endpoints require HTTPS");
  const keys = createRemoteJWKSet(new URL(config.jwksUri));
  return {
    authorization(state, nonce, verifier) {
      const url = new URL(config.authorizationEndpoint);
      for (const [k, v] of Object.entries({
        client_id: config.clientId,
        response_type: "code",
        scope: "openid",
        redirect_uri: config.redirectUri,
        state,
        nonce,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
      }))
        url.searchParams.set(k, v);
      return url.href;
    },
    async exchange(code, nonce, verifier) {
      const response = await fetch(config.tokenEndpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          code_verifier: verifier,
          redirect_uri: config.redirectUri,
        }),
      });
      if (!response.ok) throw Error("Identity exchange failed");
      const value = (await response.json()) as { id_token?: string };
      if (!value.id_token) throw Error("Missing identity token");
      const { payload } = await jwtVerify(value.id_token, keys, {
        issuer: config.issuer,
        audience: config.clientId,
        algorithms: ["RS256", "ES256"],
        requiredClaims: ["sub", "exp", "iat", "nonce"],
        maxTokenAge: "10m",
        clockTolerance: 5,
      });
      if (
        payload.nonce !== nonce ||
        typeof payload.sub !== "string" ||
        (Array.isArray(payload.aud) &&
          payload.aud.length > 1 &&
          payload.azp !== config.clientId) ||
        (payload.azp && payload.azp !== config.clientId)
      )
        throw Error("Invalid identity response");
      return payload.sub;
    },
  };
}
