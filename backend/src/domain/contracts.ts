import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
export const services = [
  "commerce",
  "provider",
  "delivery",
  "investigation",
  "payments",
] as const;
export type Service = (typeof services)[number];
export type Json = Record<string, unknown>;
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export const digest = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
export const stableId = (v: unknown) => {
  const h = digest(v);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
import { currency, type Currency } from "./money.js";
export const uuid = z.uuid();
export const minor = z.number().int().min(1).max(100_000);
export const batchInput = z.strictObject({
  buyer_id: uuid,
  unit_count: z.number().int().min(1).max(10),
  unit_price_minor: minor,
  currency,
  prompt: z.string().min(5).max(2000),
  title: z.string().min(1).max(100).optional(),
});
export const evidenceSchema = z.strictObject({
  id: uuid,
  source: z.enum(["provider", "delivery", "payments", "commerce", "support"]),
  unit_id: uuid.nullable(),
  text: z.string().min(1).max(4000),
});
export const assessmentSchema = z.strictObject({
  disposition: z.enum(["RECOVER_EXISTING", "READY_TO_CLOSE", "INCONCLUSIVE"]),
  explanation: z.string().min(15).max(3000),
  citations: z
    .array(
      z.strictObject({
        observation_id: uuid,
        quote: z.string().min(1).max(500),
      }),
    )
    .min(1)
    .max(20),
  hypotheses: z
    .array(
      z.strictObject({
        description: z.string().min(3).max(500),
        observation_ids: z.array(uuid).min(1).max(10),
      }),
    )
    .min(1)
    .max(8),
  actions: z
    .array(
      z.strictObject({
        kind: z.enum([
          "LOOKUP_TASK",
          "RESTORE_ACCESS",
          "NO_ACTION",
          "ESCALATE",
        ]),
        unit_id: uuid.nullable(),
        reason: z.string().min(3).max(500),
      }),
    )
    .min(1)
    .max(10),
});
export type Evidence = z.infer<typeof evidenceSchema>;
export type Assessment = z.infer<typeof assessmentSchema>;
export type Unit = { id: string; price_minor: number };
export type Batch = Json & {
  id: string;
  buyer_id: string;
  units: Unit[];
  currency: Currency;
  ceiling_minor: number;
  prompt: string;
  contract_hash: string;
  state: string;
  version: number;
  created_at: string;
  deadline: string;
  retention_until: string;
  consented_at?: string;
  assessment_id?: string;
  assessment_hash?: string;
  proposal_id?: string;
  payment_id?: string;
};
export type Permit = Json & {
  id: string;
  batch_id: string;
  buyer_id: string;
  contract_hash: string;
  batch_version: number;
  unit_ids: string[];
  amount_minor: number;
  currency: Currency;
  assessment_id: string;
  snapshot_hash: string;
  verification_ids: string[];
  action: "CAPTURE" | "VOID";
  expires_at: string;
  state: string;
  approval_actor: string;
  operation_id?: string;
};
export type Operation = Json & {
  id: string;
  batch_id: string;
  kind: string;
  state: string;
  amount_minor: number;
  currency: Currency;
  request_key: string;
  provider_id?: string;
  capture_id?: string;
  error_code?: string;
  permit_id?: string;
};
export function eligibleAmount(units: Unit[], ids: string[]) {
  if (new Set(ids).size !== ids.length) throw new Error("duplicate unit");
  return ids.reduce((sum, id) => {
    const unit = units.find((u) => u.id === id);
    if (!unit) throw new Error("unknown unit");
    return sum + unit.price_minor;
  }, 0);
}
export function validateAssessment(a: Assessment, evidence: Evidence[]) {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  return (
    a.citations.every((c) =>
      byId.get(c.observation_id)?.text.includes(c.quote),
    ) &&
    a.hypotheses.every((h) => h.observation_ids.every((i) => byId.has(i))) &&
    a.actions.every(
      (action) =>
        action.unit_id === null ||
        evidence.some((e) => e.unit_id === action.unit_id),
    )
  );
}
