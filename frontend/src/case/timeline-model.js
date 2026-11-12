// Shapes the service's timeline (GET /v1/batches/:id/timeline) for a resource scheduler.
// Nothing is added here: every bar comes from the service, with its basis kept
// (OBSERVED is a record; ESTIMATE is a calculation from published terms).

// Moments. Everything else is a span.
export const POINT_KINDS = new Set(["task", "recovery", "playback", "capture", "void", "refund"]);

// Kinds that belong to the first hours: the race between provider deletion and the archive.
const RACE_KINDS = new Set(["task", "provider_retention", "recovery", "playback", "capture", "void", "refund"]);

const MIN = 60_000;
const HOUR = 60 * MIN;
const time = (v) => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? null : t;
};

export function buildSchedule(view, now = Date.now()) {
  const atRisk = new Set(view?.at_risk_unit_ids || []);
  const known = new Set((view?.resources || []).map((r) => r.id));
  const events = [];
  for (const e of view?.events || []) {
    const start = time(e.startDate);
    if (start === null || !known.has(e.resourceId)) continue;
    const point = POINT_KINDS.has(e.kind);
    const end = point ? start : time(e.endDate);
    events.push({
      id: e.id,
      resourceId: e.resourceId,
      kind: e.kind,
      name: e.name,
      note: e.note || "",
      basis: e.basis === "ESTIMATE" ? "ESTIMATE" : "OBSERVED",
      point,
      // A span whose end the service does not know. Drawn to the edge, never given a made-up end.
      openEnded: !point && end === null,
      start,
      end,
      ended: !point && end !== null && end <= now,
      atRisk: e.kind === "provider_retention" && atRisk.has(e.resourceId),
    });
  }
  const starts = events.map((e) => e.start);
  const ends = events.map((e) => e.end ?? e.start);
  const first = starts.length ? Math.min(...starts) : now;
  const last = ends.length ? Math.max(...ends, now) : now + HOUR;
  const raceEnds = events
    .filter((e) => RACE_KINDS.has(e.kind))
    .map((e) => e.end ?? e.start);
  const raceLast = Math.max(first + HOUR, ...(raceEnds.length ? raceEnds : [first]), Math.min(now, first + 6 * HOUR));
  const pad = (a, b) => Math.max(5 * MIN, Math.round((b - a) * 0.04));
  const full = { start: first - pad(first, last), end: last + pad(first, last) };
  const race = { start: first - pad(first, raceLast), end: Math.min(full.end, raceLast + pad(first, raceLast)) };
  const resources = (view?.resources || []).map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    atRisk: atRisk.has(r.id),
  }));
  return {
    resources,
    events: events.map((e) => ({ ...e, end: e.openEnded ? full.end : e.end })),
    race,
    full,
    atRisk: resources.filter((r) => r.atRisk),
    estimates: events.filter((e) => e.basis === "ESTIMATE").length,
  };
}

/** CSS classes for one bar. Estimates never share the look of a record. */
export function eventClass(e) {
  return [
    "tl-ev",
    `tl-${e.kind.replace(/_/g, "-")}`,
    e.basis === "ESTIMATE" ? "tl-estimate" : "tl-observed",
    e.point ? "tl-point" : "",
    e.openEnded ? "tl-open" : "",
    e.ended ? "tl-ended" : "",
    e.atRisk ? "tl-at-risk" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function spanText(ms) {
  const m = Math.round(Math.abs(ms) / MIN);
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim();
  return `${Math.round(m / 1440)} days`;
}

/** Plain sentence for a bar: used by the tooltip and by the list under the chart. */
export function describe(e, now = Date.now()) {
  if (e.point) return "Recorded at this moment.";
  if (e.openEnded) return "No end is recorded for this.";
  const left = e.end - now;
  const verb = e.basis === "ESTIMATE" ? (left > 0 ? "Estimated to end in" : "Estimated to have ended") : left > 0 ? "Ends in" : "Ended";
  return `${verb} ${spanText(left)}${left > 0 ? "" : " ago"}.`;
}
