// Shapes the service's operations rows (GET /v1/operations/dashboard) for the dashboard.
// Money arrives in minor units of each row's own currency. It is converted to that currency's
// major unit for display and is never added across currencies: the dashboard always shows one.
import { readableState } from "../domain.js";

const scales = new Map();
export function scaleOf(currency) {
  if (!scales.has(currency)) {
    let digits = 2;
    try {
      digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    } catch {
      digits = 2;
    }
    scales.set(currency, 10 ** digits);
  }
  return scales.get(currency);
}
const major = (minor, currency) => (minor === null || minor === undefined ? null : Number(minor) / scaleOf(currency));
const short = (id) => String(id).slice(0, 8);

export function dashboardData(batchRows = [], clipRows = []) {
  const deliveries = batchRows.map((r) => ({
    id: r.batch_id,
    title: r.title || `Delivery ${short(r.batch_id)}`,
    created: r.created_at || null,
    state: readableState(r.state),
    settled: r.not_taken_minor !== null && r.not_taken_minor !== undefined,
    currency: r.currency,
    clips: r.clips,
    delivered: r.delivered,
    recovered: r.recovered,
    recoverable: r.archived_not_delivered,
    // Both counts are the service's own. Older builds had no no_provider_task; left empty then.
    noTask: r.no_provider_task ?? null,
    undelivered: r.never_rendered,
    authorized: major(r.authorized_minor, r.currency),
    charged: major(r.charged_minor, r.currency),
    // Unknown until the delivery is settled; left empty, not shown as zero.
    notTaken: major(r.not_taken_minor, r.currency),
    refunded: major(r.refunded_minor, r.currency),
    openDisputes: r.open_disputes,
    disputeDeadline: r.next_dispute_deadline || null,
    playbackPlayed: r.playback_played,
    playbackProbed: r.playback_probed,
  }));
  const clips = clipRows.map((r) => ({
    id: r.unit_id,
    batchId: r.batch_id,
    clip: `Clip ${r.clip}`,
    currency: r.currency,
    price: major(r.price_minor, r.currency),
    provider: r.provider_source || "not registered",
    task: readableState(r.task_state),
    outcome: r.recovered ? "Recovered, no new render" : r.delivered ? "Delivered" : r.archived ? "Archived, not delivered" : "Not delivered",
    archived: !!r.archived,
    delivered: !!r.delivered,
    recovered: !!r.recovered,
    playback: r.external_playback ? readableState(r.external_playback) : "not probed",
  }));
  const currencies = [...new Set(deliveries.map((d) => d.currency))].sort();
  return { deliveries, clips, currencies };
}
