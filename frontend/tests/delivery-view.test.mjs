import test from "node:test";
import assert from "node:assert/strict";
import { deliveryStage, filterDeliveries } from "../src/ui/delivery-view.js";

test("pending settlement and cancellation never appear closed or paid", () => {
  for (const state of [
    "AUTHORIZING",
    "SETTLEMENT_REQUESTED",
    "CLAIMED",
    "CANCEL_REQUESTED",
  ]) {
    const stage = deliveryStage(state);
    assert.notEqual(stage.group, "closed");
    assert.doesNotMatch(stage.label, /paid|confirmed|complete/i);
  }
  // Closure can include a void; it is not evidence of collected cash.
  assert.equal(deliveryStage("CLOSED").label, "Closed");
});

test("unknown states remain visible for review rather than being inferred successful", () => {
  assert.equal(deliveryStage("PROVIDER_OUTCOME_UNKNOWN").group, "attention");
  assert.equal(deliveryStage("PROVIDER_OUTCOME_UNKNOWN").tone, "warning");
});

test("search handles long titles, absent titles and reference lookup within the current page", () => {
  const rows = [
    {
      id: "batch-001",
      title: "Autumn collection — international social launch",
      state: "RUNNING",
    },
    { id: "batch-002", state: "CLOSED" },
    {
      id: "batch-003",
      title: "Delivery requiring evidence review",
      state: "WAITING_FOR_AI",
    },
  ];
  assert.deepEqual(filterDeliveries(rows, " INTERNATIONAL ", "all"), [rows[0]]);
  assert.deepEqual(filterDeliveries(rows, "batch-002", "all"), [rows[1]]);
  assert.deepEqual(filterDeliveries(rows, "", "attention"), [rows[2]]);
  assert.deepEqual(filterDeliveries(rows, "Autumn", "closed"), []);
  assert.deepEqual(filterDeliveries([], "", "all"), []);
});

test("the start-here journey follows the delivery record", async () => {
  const { journeySteps } = await import("../src/ui/delivery-view.js");
  const states = (b) => journeySteps({ id: "b1", ...b }).map((s) => s.state);
  assert.deepEqual(states({ state: "AWAITING_BUYER_APPROVAL" }), ["next", "later", "later", "later", "later", "later"]);
  assert.deepEqual(states({ state: "AWAITING_BUYER_APPROVAL", consented_at: "2026-11-12T00:00:00Z" }), ["done", "next", "later", "later", "later", "later"]);
  assert.deepEqual(states({ state: "AUTHORIZED" }), ["done", "done", "next", "later", "later", "later"]);
  assert.deepEqual(states({ state: "INVESTIGATED" }), ["done", "done", "done", "next", "later", "later"]);
  assert.deepEqual(states({ state: "INVESTIGATED", recovered_unit_ids: ["u8"] }), ["done", "done", "done", "done", "next", "later"]);
  assert.deepEqual(states({ state: "CLOSED", recovered_unit_ids: ["u8"] }), ["done", "done", "done", "done", "done", "next"]);
  // An unknown state never shows later steps as done.
  assert.deepEqual(states({ state: "SOMETHING_NEW" }), ["next", "later", "later", "later", "later", "later"]);
  const settle = journeySteps({ id: "b1", state: "READY_FOR_REVIEW" });
  assert.equal(settle[3].title, "Nothing needed restoring");
  assert.equal(settle[4].to, "/batches/b1/settlement");
});

test("the demo provider step appears only when asked for, after the PayPal hold", async () => {
  const { journeySteps } = await import("../src/ui/delivery-view.js");
  const keys = (b, o) => journeySteps({ id: "b1", ...b }, o).map((s) => s.key + ":" + s.state);
  assert.equal(journeySteps({ id: "b1", state: "AUTHORIZED" }).some((s) => s.key === "provider"), false);
  assert.deepEqual(keys({ state: "AWAITING_BUYER_APPROVAL" }, { demoProvider: true }).slice(0, 3), ["agree:next", "authorize:later", "provider:later"]);
  assert.deepEqual(keys({ state: "AUTHORIZED" }, { demoProvider: true }).slice(1, 4), ["authorize:done", "provider:next", "investigate:later"]);
  assert.deepEqual(keys({ state: "AUTHORIZED" }, { demoProvider: true, hasTasks: true }).slice(2, 4), ["provider:done", "investigate:next"]);
});
