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
