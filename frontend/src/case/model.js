// Pure derivations for the case workspace. No fetching, no money authority:
// these functions describe records the services returned; the server decides amounts.
import { financialState, money, paymentSummary } from "../domain.js";

/**
 * @typedef {"confirmed"|"authorized"|"pending"|"unknown"|"failed"|"refunded"|"neutral"|"ai"} Tone
 * @typedef {{ label: string, tone: Tone, detail?: string }} Cell
 * @typedef {{ index: number, id: string, price_minor: number, attempt?: object, artifact?: object,
 *   published: boolean, recoverable: boolean, restored?: object, execution: Cell, storage: Cell,
 *   access: Cell, billing: Cell }} UnitRow
 */

const pad = (n) => String(n).padStart(2, "0");
export const clipName = (index) => `Clip ${pad(index + 1)}`;
export const short = (value, n = 8) =>
  value && String(value).length > n + 4
    ? `${String(value).slice(0, n)}…`
    : String(value || "—");

const RUNNING = ["RUNNING", "PENDING", "SUBMITTED", "QUEUED", "PROCESSING"];
const UNSETTLED = ["RESERVED", "DISPATCHING", "PENDING", "NEEDS_REVIEW"];

function executionCell(attempt, known) {
  if (!known) return { label: "Not shown", tone: "neutral" };
  if (!attempt) return { label: "No task on record", tone: "neutral" };
  if (attempt.state === "SUCCEEDED")
    return { label: "Completed", tone: "confirmed" };
  if (attempt.state === "FAILED") return { label: "Failed", tone: "failed" };
  if (attempt.state === "SUBMISSION_UNKNOWN")
    return {
      label: "Unknown",
      tone: "unknown",
      detail: "Look up the original task. Do not resubmit.",
    };
  if (RUNNING.includes(attempt.state))
    return { label: "In progress", tone: "pending" };
  return { label: attempt.state.toLowerCase().replaceAll("_", " "), tone: "unknown" };
}
function storageCell(artifact, known) {
  if (!artifact)
    return { label: known ? "No file" : "Not delivered", tone: "neutral" };
  if (artifact.state === "STORED") return { label: "Archived", tone: "confirmed" };
  if (artifact.state === "QUARANTINED")
    return { label: "Quarantined", tone: "failed", detail: "Failed media validation." };
  return { label: artifact.state.toLowerCase().replaceAll("_", " "), tone: "pending" };
}

/** @returns {UnitRow[]} */
export function buildUnits({
  batch,
  artifacts = [],
  review = null,
  operations = [],
  statement = null,
  receipts = [],
}) {
  const settlement = operations.find((o) => ["CAPTURE", "VOID"].includes(o.kind));
  const refunds = operations.filter((o) => o.kind === "REFUND");
  const known = !!review && !review.unavailable;
  return batch.units.map((unit, index) => {
    const attempt = review?.attempts?.find((a) => a.unit_id === unit.id);
    const delivered = artifacts.find((a) => a.unit_id === unit.id && a.published);
    const archived = review?.artifacts?.find((a) => a.unit_id === unit.id);
    const artifact = delivered || archived;
    const published = !!delivered || !!archived?.published;
    const recoverable =
      !!archived && archived.state === "STORED" && !archived.published && !delivered;
    // A stored receipt only counts while the file is actually published.
    const restored = published ? receipts.find((r) => r.unit_id === unit.id) : undefined;
    const line = statement?.clips?.find((c) => c.unit_id === unit.id);
    const price = money(unit.price_minor, batch.currency);

    let access;
    if (published)
      access = restored
        ? { label: "Restored", tone: "confirmed", detail: "Buyer route verified after restore." }
        : { label: "Buyer can open", tone: "confirmed" };
    else if (recoverable)
      access = {
        label: "Not reachable",
        tone: "pending",
        detail: "The file exists but was never published to the buyer.",
      };
    else access = { label: "—", tone: "neutral" };

    let billing;
    const refunded = refunds.find(
      (r) => r.state === "CONFIRMED" && r.unit_ids?.includes?.(unit.id),
    );
    if (refunded) billing = { label: `Refunded ${price}`, tone: "refunded" };
    else if (settlement?.kind === "VOID" && settlement.state === "CONFIRMED")
      billing = { label: "Not charged", tone: "neutral", detail: "Authorization released." };
    else if (settlement?.state === "CONFIRMED")
      billing = (line ? line.charged : published)
        ? { label: `Charged ${price}`, tone: "confirmed" }
        : { label: "Not charged", tone: "neutral" };
    else if (settlement?.state === "UNKNOWN")
      billing = published
        ? { label: "Outcome unknown", tone: "unknown" }
        : { label: "Not billable", tone: "neutral" };
    else if (settlement && UNSETTLED.includes(settlement.state))
      billing = published
        ? { label: "Capture pending", tone: "pending" }
        : { label: "Not billable", tone: "neutral" };
    else if (published)
      billing = {
        label: `Eligible ${price}`,
        tone: "authorized",
        detail: "Estimate. The server decides at settlement review.",
      };
    else if (recoverable)
      billing = { label: "Recoverable", tone: "pending", detail: "Billable only after the buyer can open it." };
    else billing = { label: "Not billable", tone: "neutral" };

    return {
      index,
      id: unit.id,
      price_minor: unit.price_minor,
      attempt,
      artifact,
      published,
      recoverable,
      restored,
      execution: executionCell(attempt, known),
      storage: storageCell(artifact, known),
      access,
      billing,
    };
  });
}

/** Five links of the chain: payment → execution → artifact → delivery → settlement. */
export function buildChain({ batch, units, financials, operations = [], reviewKnown }) {
  const total = units.length;
  const done = units.filter((u) => u.attempt?.state === "SUCCEEDED").length;
  const stored = units.filter((u) => u.artifact?.state === "STORED").length;
  const reachable = units.filter((u) => u.published).length;
  const finance = financialState(operations);
  const totals = paymentSummary(operations);
  const auth = financials?.authorization;
  const ceiling = money(batch.ceiling_minor, batch.currency);

  const payment = financials?.unavailable
    ? { value: "Unavailable", note: "Payment record could not be read", tone: "unknown" }
    : auth?.state === "AUTHORIZED"
      ? {
          value: `${ceiling} authorized`,
          note: "A hold, not a charge",
          tone: "authorized",
          reference: auth.provider_id,
        }
      : auth
        ? { value: auth.state.toLowerCase(), note: `Ceiling ${ceiling}`, tone: "pending" }
        : { value: "Not authorized", note: `Ceiling ${ceiling}`, tone: "neutral" };

  const execution = !reviewKnown
    ? { value: "Unavailable", note: "Provider records could not be read", tone: "unknown" }
    : {
        value: `${done} of ${total} completed`,
        note:
          done === total
            ? "Every provider task finished"
            : `${total - done} without a finished task`,
        tone: done === total ? "confirmed" : done ? "pending" : "neutral",
      };
  const artifact = !reviewKnown
    ? { value: "Unavailable", note: "Archive records could not be read", tone: "unknown" }
    : {
        value: `${stored} archived`,
        note:
          stored === done
            ? "Each finished task has its original"
            : `${Math.max(0, done - stored)} finished without a stored file`,
        tone: stored && stored === done ? "confirmed" : stored ? "pending" : "neutral",
      };
  const lost = reviewKnown ? Math.max(0, stored - reachable) : 0;
  const delivery = {
    value: `${reachable} of ${total} reachable`,
    note: lost
      ? `${lost} archived ${lost === 1 ? "file" : "files"} the buyer cannot open`
      : reachable
        ? "Published on the buyer route"
        : "Nothing published yet",
    tone: lost ? "failed" : reachable ? "confirmed" : "neutral",
    broken: lost > 0,
  };
  let settlement;
  if (finance.state === "CONFIRMED")
    settlement =
      finance.operation.kind === "VOID"
        ? { value: "Authorization released", note: "Nothing was charged", tone: "neutral", reference: finance.operation.provider_id }
        : {
            value: `${money(totals.captured, batch.currency)} captured`,
            note: `${money(batch.ceiling_minor - totals.captured, batch.currency)} never taken`,
            tone: "confirmed",
            reference: finance.operation.provider_id,
          };
  else if (finance.state === "UNKNOWN")
    settlement = { value: "Outcome unknown", note: "Read back before any retry", tone: "unknown" };
  else if (finance.state === "PENDING")
    settlement = { value: "Capture pending", note: "Not yet confirmed by PayPal", tone: "pending" };
  else if (finance.state === "FAILED")
    settlement = { value: "Needs attention", note: "The settlement did not complete", tone: "failed" };
  else settlement = { value: "Not settled", note: "Awaiting merchant approval", tone: "neutral" };

  return [
    { key: "payment", title: "Payment", source: "PayPal", ...payment },
    { key: "execution", title: "Execution", source: "Provider", ...execution },
    { key: "artifact", title: "Artifact", source: "Archive", ...artifact },
    { key: "delivery", title: "Delivery", source: "Buyer route", ...delivery },
    { key: "settlement", title: "Settlement", source: "PayPal", ...settlement },
  ];
}

/** The single most useful thing the merchant can do now. */
export function nextStep({ batch, units, assessment, operations = [], financials, reviewKnown }) {
  const finance = financialState(operations);
  const eligible = units.filter((u) => u.published);
  const amount = eligible.reduce((n, u) => n + u.price_minor, 0);
  const recoverable = units.filter((u) => u.recoverable);
  const names = (rows) => rows.map((u) => pad(u.index + 1)).join(", ");
  if (finance.state === "CONFIRMED") {
    const captured = paymentSummary(operations).captured;
    return finance.operation.kind === "VOID"
      ? { kind: "receipt", tone: "neutral", title: "Authorization released. Nothing was charged.", body: "No clip met the delivery terms, so the hold was voided. A release is not a refund.", action: "View payment record" }
      : { kind: "receipt", tone: "confirmed", title: `Settled. ${money(captured, batch.currency)} captured for ${eligible.length} of ${units.length} clips.`, body: `${money(batch.ceiling_minor - captured, batch.currency)} of the authorization was never taken. That is not a refund.`, action: "View payment record" };
  }
  if (finance.state === "UNKNOWN")
    return { kind: "receipt", tone: "unknown", title: "The capture outcome is unknown.", body: "Check the original operation with PayPal. Do not submit a replacement payment.", action: "Check payment status" };
  if (finance.state === "PENDING")
    return { kind: "receipt", tone: "pending", title: "Capture requested. Not yet confirmed.", body: "Pending is not paid. The record updates when PayPal read-back confirms it.", action: "View payment status" };
  if (finance.state === "FAILED")
    return { kind: "receipt", tone: "failed", title: "The settlement needs attention.", body: "Open the payment record to see what PayPal returned.", action: "View payment record" };
  if (!financials?.unavailable && financials?.authorization?.state !== "AUTHORIZED" && !["AUTHORIZED", "RUNNING", "INVESTIGATED", "READY_FOR_REVIEW", "WAITING_FOR_AI"].includes(batch.state))
    return { kind: "none", tone: "neutral", title: "Waiting for the buyer's PayPal authorization.", body: "Nothing can be captured until the buyer approves the ceiling." };
  if (!reviewKnown)
    return { kind: "refresh", tone: "unknown", title: "Provider and archive records are unavailable.", body: "Published files stay available to the buyer. Refresh before taking financial action.", action: "Refresh records" };
  const valid = assessment?.state === "VALID" && assessment.current !== false;
  if (recoverable.length)
    return valid
      ? { kind: "restore", tone: "pending", title: `Clip ${names(recoverable)} was rendered, but the buyer cannot open it.`, body: "The original file is archived. Restore buyer access instead of paying for another render.", action: `Restore clip ${names(recoverable)}` }
      : { kind: "investigate", tone: "pending", title: `Clip ${names(recoverable)} was rendered, but the buyer cannot open it.`, body: "Investigate the provider, archive and delivery records before restoring anything.", action: "Investigate evidence" };
  if (assessment?.state === "WAITING_FOR_AI")
    return { kind: "investigate", tone: "unknown", title: "The investigation could not finish.", body: "AI is unavailable. Files, payment history and reconciliation still work.", action: "Try the investigation again" };
  if (assessment && ["INCONCLUSIVE", "INVALID"].includes(assessment.state))
    return { kind: "investigate", tone: "unknown", title: "The investigation was inconclusive.", body: "A valid, current assessment is required before normal settlement.", action: "Investigate again" };
  if (!valid)
    return { kind: "investigate", tone: "authorized", title: assessment ? "Evidence changed since the last investigation." : "Investigate delivery before settlement.", body: "Settlement review needs a current assessment of the provider, archive and delivery records.", action: assessment ? "Investigate again" : "Investigate evidence" };
  return eligible.length
    ? { kind: "settle", tone: "confirmed", title: `${eligible.length} of ${units.length} clips are verified for the buyer.`, body: `Review one final capture of ${money(amount, batch.currency)} against the ${money(batch.ceiling_minor, batch.currency)} authorization.`, action: `Review ${money(amount, batch.currency)} capture` }
    : { kind: "settle", tone: "neutral", title: "No clip met the delivery terms.", body: "Review releasing the authorization. Nothing will be charged.", action: "Review authorization release" };
}

const EVENT_LABELS = {
  AWAITING_BUYER_APPROVAL: ["Agreement created", "Fixed units, prices and ceiling."],
  ACCEPTED: ["Buyer accepted the agreement", "Consent bound to the contract hash."],
  AUTHORIZING: ["PayPal authorization requested", ""],
  AUTHORIZED: ["Delivery authorized for work", ""],
  RUNNING: ["Provider work started", ""],
  WAITING_FOR_AI: ["Investigation requested", ""],
  INVESTIGATED: ["Investigation adopted by the operator", ""],
  READY_FOR_REVIEW: ["Settlement review prepared", "Exact amount and units, expiring."],
  SETTLEMENT_REQUESTED: ["Merchant approved the settlement", ""],
  CLAIMED: ["Payments claimed the approval", "One permit, one capture."],
  CANCEL_REQUESTED: ["Cancellation requested", ""],
  CLOSED: ["Delivery closed", ""],
};

/** Chronological record. Every entry names its source; AI entries are marked as such. */
/**
 * Restored clips as the server records them (`batch.recovered`), each enriched with the
 * receipt detail returned by a restore made in this visit, when there is one. A receipt
 * the batch does not list is ignored: the server record decides what counts as restored.
 */
export function recoveryReceipts(batch, fresh = []) {
  return (batch?.recovered || []).map((r) => ({
    ...fresh.find((f) => f.unit_id === r.unit_id),
    unit_id: r.unit_id,
    artifact_id: r.artifact_id,
    observed_at: r.recovered_at,
  }));
}

export function buildTimeline({ batch, activity = [], financials, operations = [], assessment, review, receipts = [] }) {
  const items = [];
  const push = (at, source, title, detail = "", extra = {}) => {
    if (at && Number.isFinite(Date.parse(at)))
      items.push({ at, source, title, detail, ...extra });
  };
  for (const e of activity) {
    const [title, detail] = EVENT_LABELS[e.action] || [e.action.toLowerCase().replaceAll("_", " "), ""];
    push(e.recorded_at, "Commerce", title, detail, { key: e.sequence });
  }
  const auth = financials?.authorization;
  if (auth?.confirmed_at)
    push(auth.confirmed_at, "PayPal", `Authorization confirmed for ${money(auth.amount_minor, batch.currency)}`, "A hold on the buyer's funds. Not a charge.", { reference: auth.provider_id, tone: "authorized" });
  for (const a of review?.attempts || [])
    push(a.created_at, "Provider", `Task ${a.state === "SUCCEEDED" ? "completed" : a.state.toLowerCase().replaceAll("_", " ")} for clip ${pad(batch.units.findIndex((u) => u.id === a.unit_id) + 1)}`, "", { reference: a.provider_task_id, tone: a.state === "SUCCEEDED" ? "confirmed" : a.state === "FAILED" ? "failed" : "pending" });
  if (assessment?.completed_at || assessment?.created_at)
    push(assessment.completed_at || assessment.created_at, "AI", `Investigation ${assessment.state === "VALID" ? "completed" : assessment.state.toLowerCase().replaceAll("_", " ")}`, "Cited findings and proposals. No authority over money.", { reference: assessment.model, tone: "ai" });
  for (const r of receipts)
    push(r.observed_at, "Delivery", `Original restored for clip ${pad(batch.units.findIndex((u) => u.id === r.unit_id) + 1)}`, r.outcome ? `Buyer route check: ${String(r.outcome).toLowerCase()}. No new render.` : "Recorded by the service. No new render.", { reference: r.receipt_hash, tone: "confirmed" });
  for (const op of operations) {
    const kind = op.kind === "CAPTURE" ? "Capture" : op.kind === "VOID" ? "Authorization release" : "Refund";
    const state = op.state === "CONFIRMED" ? "confirmed" : op.state === "UNKNOWN" ? "outcome unknown" : op.state.toLowerCase().replaceAll("_", " ");
    push(op.confirmed_at || op.updated_at || op.created_at, "PayPal", `${kind} ${state}${op.kind === "VOID" ? "" : ` for ${money(op.amount_minor, batch.currency)}`}`, op.kind === "REFUND" ? "Against the original capture." : op.state === "CONFIRMED" ? "Confirmed by read-back." : "Not confirmed. Pending is not paid.", { reference: op.provider_id || op.id, tone: op.state === "CONFIRMED" ? (op.kind === "REFUND" ? "refunded" : "confirmed") : op.state === "UNKNOWN" ? "unknown" : "pending" });
  }
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** What the records do not establish. Shown separately from facts and AI reading. */
export function buildUnknowns({ units, assessment, financials, operations = [], reviewKnown }) {
  const out = [];
  const names = (rows) => rows.map((u) => pad(u.index + 1)).join(", ");
  if (!reviewKnown) out.push("Provider and archive records could not be read just now.");
  const noTask = units.filter((u) => reviewKnown && !u.attempt);
  if (noTask.length) out.push(`Clip ${names(noTask)}: no provider task is on record, so nothing shows whether work was ever submitted.`);
  const failed = units.filter((u) => u.attempt?.state === "FAILED");
  if (failed.length) out.push(`Clip ${names(failed)}: the provider reported failure. Why it failed is not in these records.`);
  const uncertain = units.filter((u) => u.attempt?.state === "SUBMISSION_UNKNOWN");
  if (uncertain.length) out.push(`Clip ${names(uncertain)}: the submission outcome is unknown. Look up the original task; a new request could pay twice.`);
  const orphan = units.filter((u) => u.attempt?.state === "SUCCEEDED" && !u.artifact);
  if (orphan.length) out.push(`Clip ${names(orphan)}: the task finished but no original is archived yet.`);
  if (!assessment) out.push("No investigation has been run on the current records.");
  // Settlement itself changes the records; that is not an open question about the outcome.
  else if (assessment.current === false && !operations.some((o) => ["CAPTURE", "VOID"].includes(o.kind) && o.state === "CONFIRMED")) out.push("Records changed after the last investigation. Its findings describe an earlier state.");
  if (financials?.unavailable) out.push("The payment record is unavailable. No amount on this page is confirmed.");
  if (operations.some((o) => o.state === "UNKNOWN")) out.push("A PayPal operation has an unknown outcome until read-back resolves it.");
  out.push("Creative quality is outside these checks. The contract bills technically valid files the buyer can retrieve.");
  return out;
}

export async function sha256Hex(blob) {
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, "0")).join("");
}

/* Assay proof line: six stations, each verified, pending, broken, inferred or unknown.
   Built on buildChain so the money rules stay in one place. */
const STATION_STATE = { confirmed: "verified", authorized: "pending", pending: "pending", neutral: "pending", failed: "broken", unknown: "unknown" };
const STATION_COPY = {
  agreement: ["Agreement", "What was promised"],
  payment: ["Payment", "What PayPal holds"],
  execution: ["Execution", "What the provider did"],
  artifact: ["Artifact", "What was stored"],
  delivery: ["Delivery", "What the customer received"],
  settlement: ["Settlement", "What was charged"],
};
export function buildStations(input) {
  const { batch, units } = input;
  const chain = buildChain(input);
  const price = units[0] ? money(units[0].price_minor, batch.currency) : "";
  const agreement = {
    key: "agreement",
    state: batch.contract_hash || batch.consented_at ? "verified" : "pending",
    value: `${units.length} clips at ${price}`,
    note: `Ceiling ${money(batch.ceiling_minor, batch.currency)}. Billable when valid and retrievable.`,
    source: "Contract",
    reference: batch.contract_hash,
  };
  const rest = chain.map((link) => {
    let state = STATION_STATE[link.tone] || "pending";
    // A hold is real and confirmed as a hold; it is still not a charge.
    if (link.key === "payment" && link.tone === "authorized") state = "verified";
    // Execution and archive counts are observed facts even when some clips failed;
    // the break, if any, shows at delivery.
    if (["execution", "artifact"].includes(link.key) && link.tone === "pending") state = "verified";
    return { key: link.key, state, value: link.value, note: link.note, source: link.source, reference: link.reference, broken: !!link.broken };
  });
  return [agreement, ...rest].map((s) => ({ ...s, title: STATION_COPY[s.key][0], subtitle: STATION_COPY[s.key][1] }));
}
export const STATE_WORD = { verified: "Verified", pending: "Pending", broken: "Broken", inferred: "Inferred", unknown: "Unknown" };

const SOURCE_STATION = { Provider: "execution", Delivery: "delivery", AI: "analysis" };
export function stationOf(event) {
  if (SOURCE_STATION[event.source]) return SOURCE_STATION[event.source];
  if (event.source === "PayPal") return /Authorization confirmed/.test(event.title) ? "payment" : "settlement";
  return /settlement|approved|claimed|closed/i.test(event.title) ? "settlement" : "agreement";
}
