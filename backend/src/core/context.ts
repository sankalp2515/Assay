import type { Database } from "./database.js";
import type { Actor, Identity } from "./auth.js";
import type {
  Service,
  Json,
  Evidence,
  Assessment,
} from "../domain/contracts.js";
import type { Interpretation } from "../domain/claims.js";
export interface PayPal {
  available: boolean;
  createOrder(batchId: string, amount: number, key: string): Promise<Json>;
  authorizeOrder(orderId: string, key: string): Promise<Json>;
  getOrder(id: string): Promise<Json>;
  getAuthorization(id: string): Promise<Json>;
  capture(
    authId: string,
    amount: number,
    key: string,
    details?: { invoice_id: string; note_to_payer: string },
  ): Promise<Json>;
  getCapture(id: string): Promise<Json>;
  void(authId: string, key: string): Promise<Json>;
  refund(captureId: string, amount: number, key: string): Promise<Json>;
  getRefund(id: string): Promise<Json>;
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
  artifactDir: string;
  allowPaid: boolean;
  maxAttempts: number;
  merchantId: string;
  publicOrigin: string;
  fixture: boolean;
  now: () => number;
}
export type RequestActor = { actor: Actor };
