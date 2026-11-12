import test from "node:test";
import assert from "node:assert/strict";
import { buildSchedule, describe, eventClass, spanText } from "../src/case/timeline-model.js";
import { dashboardData, scaleOf } from "../src/ops/dashboard-model.js";

const T0 = Date.parse("2026-11-12T10:00:00Z");
const at = (min) => new Date(T0 + min * 60000).toISOString();
const view = {
  resources: [
    { id: "paypal", name: "PayPal", kind: "payment" },
    { id: "u1", name: "Clip 1", kind: "clip" },
    { id: "u2", name: "Clip 2", kind: "clip" },
  ],
  events: [
    { id: "a", resourceId: "paypal", kind: "authorization_validity", name: "Hold", startDate: at(0), endDate: at(29 * 1440), basis: "OBSERVED" },
    { id: "b", resourceId: "paypal", kind: "authorization_honor", name: "Honored", startDate: at(0), endDate: at(3 * 1440), basis: "ESTIMATE" },
    { id: "c", resourceId: "u1", kind: "task", name: "Task", startDate: at(2), endDate: null, basis: "OBSERVED" },
    { id: "d", resourceId: "u1", kind: "provider_retention", name: "Provider keeps output", startDate: at(2), endDate: at(62), basis: "ESTIMATE" },
    { id: "e", resourceId: "u2", kind: "provider_retention", name: "Provider keeps output", startDate: at(3), endDate: at(63), basis: "ESTIMATE" },
    { id: "f", resourceId: "u2", kind: "archive", name: "Archived", startDate: at(5), endDate: null, basis: "OBSERVED" },
    { id: "g", resourceId: "gone", kind: "archive", name: "Orphan", startDate: at(5), endDate: at(9), basis: "OBSERVED" },
    { id: "h", resourceId: "u1", kind: "archive", name: "No start", startDate: null, endDate: at(9), basis: "OBSERVED" },
  ],
  at_risk_unit_ids: ["u1"],
};

test("the schedule keeps each bar's basis and never invents an end", () => {
  const s = buildSchedule(view, T0 + 10 * 60000);
  assert.deepEqual(s.events.map((e) => e.id), ["a", "b", "c", "d", "e", "f"]);
  const by = Object.fromEntries(s.events.map((e) => [e.id, e]));
  assert.equal(by.b.basis, "ESTIMATE");
  assert.equal(by.a.basis, "OBSERVED");
  assert.equal(by.c.point, true);
  assert.equal(by.c.end, by.c.start);
  assert.equal(by.f.openEnded, true);
  assert.equal(by.f.end, s.full.end);
  assert.equal(describe(by.f), "No end is recorded for this.");
  assert.equal(s.estimates, 3);
});

test("only an unarchived clip's provider window is marked at risk", () => {
  const s = buildSchedule(view, T0 + 10 * 60000);
  assert.deepEqual(s.atRisk.map((r) => r.id), ["u1"]);
  const by = Object.fromEntries(s.events.map((e) => [e.id, e]));
  assert.equal(by.d.atRisk, true);
  assert.equal(by.e.atRisk, false);
  assert.match(eventClass(by.d), /tl-estimate/);
  assert.match(eventClass(by.d), /tl-at-risk/);
  assert.match(eventClass(by.a), /tl-observed/);
  assert.doesNotMatch(eventClass(by.a), /tl-estimate/);
});

test("the first-hours range covers the provider race and stays inside the whole window", () => {
  const s = buildSchedule(view, T0 + 10 * 60000);
  assert.ok(s.race.start <= T0);
  assert.ok(s.race.end >= T0 + 63 * 60000);
  assert.ok(s.race.end < T0 + 12 * 3600000);
  assert.ok(s.full.end >= T0 + 29 * 86400000);
  assert.ok(s.race.end <= s.full.end);
});

test("bar sentences say estimate when it is one", () => {
  const now = T0 + 10 * 60000;
  const by = Object.fromEntries(buildSchedule(view, now).events.map((e) => [e.id, e]));
  assert.equal(describe(by.d, now), "Estimated to end in 52 min.");
  assert.equal(describe(by.d, T0 + 122 * 60000), "Estimated to have ended 1 h ago.");
  assert.equal(describe(by.c, now), "Recorded at this moment.");
  assert.equal(spanText(3 * 86400000), "3 days");
});

test("an empty or missing timeline yields an empty schedule", () => {
  const s = buildSchedule(null, T0);
  assert.equal(s.events.length, 0);
  assert.ok(s.full.end > s.full.start);
});

test("dashboard money uses each currency's own unit and leaves unsettled amounts empty", () => {
  const base = { clips: 10, delivered: 8, recovered: 1, archived_not_delivered: 0, never_rendered: 2, no_provider_task: 0, refunded_minor: 0, open_disputes: 0, playback_played: 0, playback_probed: 0 };
  const d = dashboardData(
    [
      { ...base, batch_id: "aaaaaaaa-1", title: null, state: "CLOSED", currency: "USD", authorized_minor: 5000, charged_minor: 4000, not_taken_minor: 1000 },
      { ...base, batch_id: "bbbbbbbb-2", title: "Tokyo", state: "AUTHORIZED", currency: "JPY", authorized_minor: 5000, charged_minor: 0, not_taken_minor: null, delivered: 7, archived_not_delivered: 1 },
    ],
    [
      { batch_id: "aaaaaaaa-1", unit_id: "u1", clip: 1, currency: "USD", price_minor: 500, provider_source: null, task_state: "NOT_REGISTERED", archived: true, delivered: true, recovered: true, external_playback: null },
      { batch_id: "bbbbbbbb-2", unit_id: "u2", clip: 2, currency: "JPY", price_minor: 500, provider_source: "runway", task_state: "SUCCEEDED", archived: true, delivered: false, recovered: false, external_playback: "PLAYED" },
    ],
  );
  assert.equal(scaleOf("JPY"), 1);
  assert.deepEqual(d.currencies, ["JPY", "USD"]);
  const [usd, jpy] = d.deliveries;
  assert.equal(usd.title, "Delivery aaaaaaaa");
  assert.equal(usd.charged, 40);
  assert.equal(usd.notTaken, 10);
  assert.equal(usd.settled, true);
  assert.equal(jpy.authorized, 5000);
  assert.equal(jpy.notTaken, null);
  assert.equal(jpy.settled, false);
  assert.equal(jpy.undelivered, 2);
  assert.equal(jpy.noTask, 0);
  assert.equal(dashboardData([{ ...base, batch_id: "c", currency: "USD", no_provider_task: undefined }]).deliveries[0].noTask, null);
  assert.equal(d.clips[0].outcome, "Recovered, no new render");
  assert.equal(d.clips[0].provider, "not registered");
  assert.equal(d.clips[1].outcome, "Archived, not delivered");
  assert.equal(d.clips[1].price, 500);
});
