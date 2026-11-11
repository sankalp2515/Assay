import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChain,
  buildTimeline,
  buildUnits,
  buildUnknowns,
  nextStep,
} from "../src/case/model.js";

const batch = {
  id: "b1",
  currency: "USD",
  ceiling_minor: 5000,
  state: "AUTHORIZED",
  units: Array.from({ length: 10 }, (_, i) => ({ id: `u${i + 1}`, price_minor: 500 })),
};
const attempts = batch.units.slice(0, 8).map((u, i) => ({
  id: `a${i}`,
  unit_id: u.id,
  state: "SUCCEEDED",
  provider_task_id: `T${i}`,
}));
const archive = (publishedCount) =>
  batch.units.slice(0, 8).map((u, i) => ({
    id: `f${i}`,
    unit_id: u.id,
    state: "STORED",
    published: i < publishedCount,
  }));
const outcomes = (publishedCount) =>
  archive(publishedCount).filter((a) => a.published);
const financials = {
  authorization: { state: "AUTHORIZED", amount_minor: 5000, provider_id: "AUTH" },
};
const capture = (state = "CONFIRMED") => ({
  id: "op",
  kind: "CAPTURE",
  state,
  amount_minor: 4000,
  provider_id: "CAP",
});

test("an archived but unpublished original is recoverable, not billable", () => {
  const units = buildUnits({
    batch,
    artifacts: outcomes(7),
    review: { attempts, artifacts: archive(7) },
  });
  assert.equal(units.filter((u) => u.published).length, 7);
  assert.equal(units[7].recoverable, true);
  assert.equal(units[7].billing.label, "Recoverable");
  assert.equal(units[7].access.tone, "pending");
  assert.equal(units[8].execution.label, "No task on record");
  assert.equal(units[8].billing.label, "Not billable");
  assert.equal(units[0].billing.tone, "authorized");
});

test("the chain marks delivery as the broken link and never shows a hold as paid", () => {
  const review = { attempts, artifacts: archive(7) };
  const units = buildUnits({ batch, artifacts: outcomes(7), review });
  const chain = buildChain({ batch, units, financials, operations: [], reviewKnown: true });
  assert.equal(chain[0].tone, "authorized");
  assert.match(chain[0].note, /not a charge/i);
  assert.equal(chain[3].broken, true);
  assert.equal(chain[4].value, "Not settled");
});

test("next step walks investigate → restore → settle → receipt", () => {
  const review = { attempts, artifacts: archive(7) };
  let units = buildUnits({ batch, artifacts: outcomes(7), review });
  const base = { batch, financials, reviewKnown: true, operations: [] };
  assert.equal(nextStep({ ...base, units, assessment: null }).kind, "investigate");
  assert.equal(
    nextStep({ ...base, units, assessment: { state: "VALID", current: true } }).kind,
    "restore",
  );
  units = buildUnits({ batch, artifacts: outcomes(8), review: { attempts, artifacts: archive(8) } });
  assert.equal(
    nextStep({ ...base, units, assessment: { state: "VALID", current: false } }).kind,
    "investigate",
  );
  const settle = nextStep({ ...base, units, assessment: { state: "VALID", current: true } });
  assert.equal(settle.kind, "settle");
  assert.match(settle.action, /\$40\.00/);
  const done = nextStep({ ...base, units, assessment: null, operations: [capture()] });
  assert.equal(done.kind, "receipt");
  assert.match(done.title, /\$40\.00 captured/);
  assert.match(done.body, /\$10\.00.*never taken.*not a refund/i);
});

test("pending and unknown captures are never presented as charged", () => {
  const review = { attempts, artifacts: archive(8) };
  for (const [state, tone] of [["PENDING", "pending"], ["UNKNOWN", "unknown"]]) {
    const operations = [capture(state)];
    const units = buildUnits({ batch, artifacts: outcomes(8), review, operations });
    assert.equal(units[0].billing.tone, tone);
    assert.doesNotMatch(units[0].billing.label, /charged/i);
    const chain = buildChain({ batch, units, financials, operations, reviewKnown: true });
    assert.equal(chain[4].tone, tone);
    assert.doesNotMatch(chain[4].value, /captured/i);
    assert.equal(nextStep({ batch, units, financials, operations, reviewKnown: true }).tone, tone);
  }
});

test("a confirmed capture follows the statement, and a void charges nothing", () => {
  const review = { attempts, artifacts: archive(8) };
  const statement = { clips: batch.units.map((u, i) => ({ unit_id: u.id, charged: i < 8 })) };
  let units = buildUnits({ batch, artifacts: outcomes(8), review, operations: [capture()], statement });
  assert.equal(units[7].billing.label, "Charged $5.00");
  assert.equal(units[9].billing.label, "Not charged");
  const voided = [{ id: "v", kind: "VOID", state: "CONFIRMED", amount_minor: 0 }];
  units = buildUnits({ batch, artifacts: [], review: { attempts: [], artifacts: [] }, operations: voided });
  assert.ok(units.every((u) => u.billing.label === "Not charged"));
  const chain = buildChain({ batch, units, financials, operations: voided, reviewKnown: true });
  assert.equal(chain[4].value, "Authorization released");
});

test("buyers see delivery state without provider internals", () => {
  const units = buildUnits({ batch, artifacts: outcomes(7), review: null });
  assert.equal(units[0].execution.label, "Not shown");
  assert.equal(units[7].recoverable, false);
  assert.equal(units[7].storage.label, "Not delivered");
});

test("unknowns and timeline keep sources explicit", () => {
  const review = { attempts, artifacts: archive(7) };
  const units = buildUnits({ batch, artifacts: outcomes(7), review });
  const unknowns = buildUnknowns({ units, assessment: null, financials, operations: [], reviewKnown: true });
  assert.ok(unknowns.some((u) => /no provider task is on record/.test(u)));
  assert.ok(unknowns.some((u) => /No investigation/.test(u)));
  const timeline = buildTimeline({
    batch,
    activity: [{ sequence: "1", action: "AUTHORIZED", recorded_at: "2026-11-10T10:00:02Z" }],
    financials: { authorization: { ...financials.authorization, confirmed_at: "2026-11-10T10:00:01Z" } },
    operations: [{ ...capture(), confirmed_at: "2026-11-10T10:05:00Z" }],
    assessment: { state: "VALID", model: "m", completed_at: "2026-11-10T10:03:00Z" },
    review,
  });
  assert.deepEqual(timeline.map((e) => e.source), ["PayPal", "Commerce", "AI", "PayPal"]);
  assert.equal(timeline[2].tone, "ai");
  assert.match(timeline[0].detail, /Not a charge/);
});
