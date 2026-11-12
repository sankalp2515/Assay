// @assay/node: a small, dependency-free client for the Assay Commerce API.
// Use it from your server only. A secret key (assay_sk_…) must never reach a browser;
// give the browser a buyer session token (assay_bt_…) from `buyerSessions.create`.
import { createHmac, timingSafeEqual } from "node:crypto";

export type Currency = "USD" | "EUR" | "GBP" | "CAD" | "AUD" | "JPY";
export type TaskSource = "runway" | "replicate" | "reported";
export interface AssayOptions {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}
export class AssayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly traceId?: string,
  ) {
    super(message);
    this.name = "AssayError";
  }
}
type Body = Record<string, unknown>;

export class Assay {
  private base: string;
  private net: typeof fetch;
  constructor(private o: AssayOptions) {
    if (!/^assay_(sk|bt)_/.test(o.apiKey)) throw new Error("apiKey must be an Assay key");
    const url = new URL(o.baseUrl);
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname))
      throw new Error("baseUrl must be https");
    this.base = url.origin + url.pathname.replace(/\/+$/, "");
    this.net = o.fetch ?? fetch;
  }

  // Every write takes an idempotency key you choose (an order id, a task id). Retrying
  // with the same key returns the first result; a new key is a new request.
  private async request<T = Body>(method: "GET" | "POST", path: string, body?: Body, idempotencyKey?: string): Promise<T> {
    if (method === "POST" && !/^[\w.:-]{8,128}$/.test(idempotencyKey ?? ""))
      throw new Error("idempotencyKey is required for writes: 8-128 letters, digits, _ . : -");
    const r = await this.net(this.base + path, {
      method,
      headers: {
        authorization: "Bearer " + this.o.apiKey,
        ...(method === "POST" ? { "content-type": "application/json", "idempotency-key": idempotencyKey! } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 30000),
      redirect: "error",
    });
    const data = (await r.json().catch(() => ({}))) as Body;
    if (!r.ok)
      throw new AssayError(
        r.status,
        String(data.code ?? "http_" + r.status),
        String(data.message ?? "Request failed"),
        Boolean(data.retryable ?? r.status >= 500),
        data.trace_id ? String(data.trace_id) : undefined,
      );
    return data as T;
  }

  readonly account = { get: () => this.request("GET", "/v1/account") };

  readonly batches = {
    create: (
      input: { buyer_id: string; unit_count: number; unit_price_minor: number; currency: Currency; prompt: string; title?: string },
      idempotencyKey: string,
    ) => this.request("POST", "/v1/batches", input, idempotencyKey),
    get: (batchId: string) => this.request("GET", "/v1/batches/" + id(batchId)),
    list: () => this.request("GET", "/v1/batches"),
    // Register a provider task as soon as the provider accepts it. Assay archives the
    // output when it finishes, before the provider deletes it.
    registerTask: (
      batchId: string,
      input: { unit_id: string; source: TaskSource; provider_task_id: string; output_url?: string; deliver_on_archive?: boolean },
      idempotencyKey: string,
    ) => this.request("POST", "/v1/batches/" + id(batchId) + "/tasks", input, idempotencyKey),
    preserve: (batchId: string, attemptId: string, idempotencyKey: string) =>
      this.request("POST", "/v1/batches/" + id(batchId) + "/preserve", { attempt_id: attemptId }, idempotencyKey),
    investigate: (batchId: string, idempotencyKey: string) =>
      this.request("POST", "/v1/batches/" + id(batchId) + "/investigate", {}, idempotencyKey),
    recover: (batchId: string, input: { artifact_id: string; assessment_id: string }, idempotencyKey: string) =>
      this.request("POST", "/v1/batches/" + id(batchId) + "/recover", input, idempotencyKey),
    // The exact amount to approve. It expires; approve with the digest it returns.
    closurePreview: (batchId: string, idempotencyKey: string) =>
      this.request("POST", "/v1/batches/" + id(batchId) + "/closure-preview", {}, idempotencyKey),
    approve: (batchId: string, input: { proposal_id: string; approval_digest: string }, idempotencyKey: string) =>
      this.request("POST", "/v1/batches/" + id(batchId) + "/approve", input, idempotencyKey),
    statement: (batchId: string) => this.request("GET", "/v1/batches/" + id(batchId) + "/statement"),
    disputes: (batchId: string) => this.request("GET", "/v1/batches/" + id(batchId) + "/disputes"),
    timeline: (batchId: string) => this.request("GET", "/v1/batches/" + id(batchId) + "/timeline"),
    playback: (batchId: string) => this.request("GET", "/v1/batches/" + id(batchId) + "/playback"),
    // Normal delivery of an archived clip (no recovery, no AI).
    deliver: (batchId: string, artifactId: string, idempotencyKey: string) =>
      this.request("POST", "/v1/batches/" + id(batchId) + "/deliver", { artifact_id: artifactId }, idempotencyKey),
  };

  readonly operations = {
    dashboard: (level: "batch" | "clip" = "batch") => this.request("GET", "/v1/operations/dashboard?level=" + level),
  };

  readonly connect = {
    // Your Replicate webhook URL: pass it as `webhook` when creating predictions.
    replicate: (idempotencyKey: string) => this.request("POST", "/v1/connect/replicate", {}, idempotencyKey),
  };

  readonly buyerSessions = {
    // A 30-minute token for one buyer and one batch, for your buyer's browser.
    create: (input: { batch_id: string; buyer_id: string }, idempotencyKey: string) =>
      this.request<{ buyer_token: string; expires_at: string }>("POST", "/v1/buyer-sessions", input, idempotencyKey),
  };

  readonly apiKeys = {
    create: (input: { name: string; scope: "operator" | "integration" }, idempotencyKey: string) =>
      this.request("POST", "/v1/api-keys", input, idempotencyKey),
    list: () => this.request("GET", "/v1/api-keys"),
    revoke: (keyId: string, idempotencyKey: string) =>
      this.request("POST", "/v1/api-keys/" + id(keyId) + "/revoke", {}, idempotencyKey),
  };

  readonly impact = { get: () => this.request("GET", "/v1/operations/impact") };
}

const id = (v: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(v)) throw new Error("Expected a UUID");
  return v;
};

// Verify an Assay webhook. Pass the raw request body exactly as received.
// Header: Assay-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw>">
export function verifyWebhook(
  secret: string,
  signatureHeader: string,
  rawBody: string,
  options: { toleranceSeconds?: number; now?: number } = {},
) {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => p.trim().split("=") as [string, string]),
  );
  const t = Number(parts.t);
  const nowSec = options.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(t) || Math.abs(nowSec - t) > (options.toleranceSeconds ?? 300)) return false;
  const expected = createHmac("sha256", secret).update(t + "." + rawBody).digest();
  const given = Buffer.from(String(parts.v1 ?? ""), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type AssayEvent =
  | { id: string; type: "clip.recovered"; created_at: string; data: { batch_id: string; unit_id: string; artifact_id: string } }
  | {
      id: string;
      type: "batch.settled" | "batch.voided";
      created_at: string;
      data: { batch_id: string; amount_minor: number; currency: Currency; clips_charged: number; clips_total: number; statement_path: string };
    }
  | {
      id: string;
      type: "dispute.opened" | "dispute.updated" | "dispute.resolved";
      created_at: string;
      data: { batch_id: string; dispute_id: string; status: string; reason: string; evidence_path: string };
    };
