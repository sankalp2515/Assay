// Google Cloud access tokens without a client library or a key file.
// On Cloud Run the service's own service account is used through the metadata server,
// so no Google credential is ever stored in configuration. For a local test against a
// real project, GOOGLE_ACCESS_TOKEN may hold a short-lived token from
// `gcloud auth print-access-token`; it expires within an hour.
let cached: { token: string; until: number } | undefined;

export async function googleAccessToken(network: typeof fetch = fetch) {
  if (process.env.GOOGLE_ACCESS_TOKEN) return process.env.GOOGLE_ACCESS_TOKEN;
  if (cached && cached.until > Date.now()) return cached.token;
  const r = await network(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    },
  );
  if (!r.ok) throw new Error("Google metadata token unavailable");
  const d = (await r.json()) as { access_token: string; expires_in: number };
  cached = { token: d.access_token, until: Date.now() + (d.expires_in - 120) * 1000 };
  return d.access_token;
}

export function resetGoogleTokenCache() {
  cached = undefined;
}
