import type { Database } from "./database.js";
import type { Actor, Identity } from "./auth.js";
import type {
  Service,
  Json,
  Evidence,
  Assessment,
} from "../domain/contracts.js";
import type { Interpretation } from "../domain/claims.js";
import type { Currency } from "../domain/money.js";
import type { BlobStore } from "../adapters/storage.js";
import type { PlaybackProber } from "../adapters/kernel.js";
// Batch currency, and the PayPal merchant the money belongs to. Without merchantId the
// platform's own PayPal account is used (single-merchant deployments).
export type PayOptions = { currency?: Currency; merchantId?: string };
export interface PayPal {
  available: boolean;
  clientId?: string;
  createOrder(batchId: string, amount: number, key: string, o?: PayOptions): Promise<Json>;
  authorizeOrder(orderId: string, key: string, o?: PayOptions): Promise<Json>;
  getOrder(id: string, o?: PayOptions): Promise<Json>;
  getAuthorization(id: string, o?: PayOptions): Promise<Json>;
  capture(
    authId: string,
    amount: number,
    key: string,
    details?: { invoice_id: string; note_to_payer: string },
    o?: PayOptions,
  ): Promise<Json>;
  getCapture(id: string, o?: PayOptions): Promise<Json>;
  void(authId: string, key: string, o?: PayOptions): Promise<Json>;
  refund(captureId: string, amount: number, key: string, o?: PayOptions): Promise<Json>;
  getRefund(id: string, o?: PayOptions): Promise<Json>;
  getDispute?(id: string, o?: PayOptions): Promise<Json>;
  createPartnerReferral?(trackingId: string, returnUrl: string): Promise<Json>;
  getMerchantIntegration?(merchantId: string): Promise<Json>;
  verifyWebhook(headers: Record<string, string>, event: Json): Promise<boolean>;
}
export interface Model {
  available: boolean;
  assess(
    evidence: Evidence[],
    read?: (unit: string) => Promise<Evidence[]>,
  ): Promise<{
    assessment: Assessment;
    model: string;
    provenance: "real" | "fixture";
    tool_calls: number;
    evidence?: Evidence[];
    attempted_models?: { provider: string; outcome: string }[];
  }>;
  // Reads a buyer's free-text message into cited clip claims. Never decides outcomes.
  interpret?(
    message: string,
    clipCount: number,
  ): Promise<{
    interpretation: Interpretation;
    model: string;
    provenance: "real" | "fixture";
    attempted_models?: { provider: string; outcome: string }[];
  }>;
}
export interface VideoProvider {
  available: boolean;
  name?: string;
  lookup(id: string): Promise<Json>;
  submit(prompt: string): Promise<Json>;
}
export type Call = (
  target: Service,
  path: string,
  tenant: string,
  body?: Json,
  key?: string,
) => Promise<Json>;
export interface Context {
  name: Service;
  db: Database;
  identity: Identity;
  call: Call;
  paypal?: PayPal;
  model?: Model;
  provider?: VideoProvider;
  // Additional lookup adapters by name (e.g. replicate). `provider` stays the default (Runway).
  providers?: Record<string, VideoProvider>;
  artifactDir: string;
  // Archived originals. Defaults to files in artifactDir.
  store?: BlobStore;
  // External playback proof (KERNEL), Delivery only.
  prober?: PlaybackProber;
  allowPaid: boolean;
  maxAttempts: number;
  merchantId: string;
  publicOrigin: string;
  fixture: boolean;
  now: () => number;
}
export type RequestActor = { actor: Actor };
