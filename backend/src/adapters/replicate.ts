import type { VideoProvider } from "../core/context.js";
import type { Json } from "../domain/contracts.js";
import { Problem, unavailable } from "../core/errors.js";

// Replicate status words mapped to the states the rest of the system uses.
const STATES: Record<string, string> = {
  starting: "PENDING",
  processing: "RUNNING",
  succeeded: "SUCCEEDED",
  failed: "FAILED",
  canceled: "CANCELLED",
  aborted: "CANCELLED",
};

// Lookup-only. The merchant keeps generating on Replicate with its own account; Assay
// reads the prediction it was told about so a finished output is found and archived
// before Replicate deletes it (one hour by default for API outputs).
export class Replicate implements VideoProvider {
  available: boolean;
  readonly name = "replicate";
  constructor(
    private token: string,
    private network: typeof fetch = fetch,
  ) {
    this.available = !!token;
  }
  async lookup(id: string): Promise<Json> {
    if (!this.available) throw unavailable("Replicate");
    const r = await this.network(
      "https://api.replicate.com/v1/predictions/" + encodeURIComponent(id),
      {
        headers: { authorization: "Bearer " + this.token },
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      },
    );
    if (!r.ok)
      throw new Problem(
        r.status >= 500 ? 503 : 422,
        "provider_rejected",
        "Provider rejected request",
      );
    return normalizeReplicate((await r.json()) as Json);
  }
  submit(): Promise<Json> {
    throw new Problem(
      403,
      "inference_disabled",
      "Replicate is lookup-only: the merchant generates; Assay recovers and settles",
    );
  }
}

export function normalizeReplicate(p: Json): Json {
  const raw = p.output as unknown;
  const output = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(
    (x): x is string => typeof x === "string",
  );
  return {
    id: String(p.id),
    status: STATES[String(p.status)] ?? "UNKNOWN",
    output,
    provider: "replicate",
  };
}
