import test from "node:test";
import assert from "node:assert/strict";
import {
  demoBatch,
  demoArtifacts,
  payable,
  financialState,
  approvalExpired,
  validatePreview,
  paymentSummary,
  safeApprovalUrl,
  usdMinor,
} from "../src/domain.js";
test("USD form prices use exact cents rather than floating point comparisons", () => {
  assert.equal(usdMinor("19.99"), 1999);
  assert.equal(usdMinor("0.01"), 1);
  assert.equal(usdMinor("5"), 500);
  for (const value of ["0", "1.001", "-1", "1e2", "1000.01"])
    assert.throws(() => usdMinor(value));
});

test("payment accounting separates confirmed cash, pending refunds and unused authorization", () => {
  assert.deepEqual(
    paymentSummary([
      { kind: "CAPTURE", state: "CONFIRMED", amount_minor: 4000 },
      { kind: "REFUND", state: "CONFIRMED", amount_minor: 500 },
      { kind: "REFUND", state: "UNKNOWN", amount_minor: 500 },
      { kind: "CAPTURE", state: "PENDING", amount_minor: 9000 },
    ]),
    { captured: 4000, refunded: 500, pendingRefund: 500, net: 3500 },
  );
});
test("only trusted Sandbox PayPal approval links can leave the application", () => {
  assert.equal(
    safeApprovalUrl("https://www.sandbox.paypal.com/checkoutnow?token=test"),
    "https://www.sandbox.paypal.com/checkoutnow?token=test",
  );
  for (const url of [
    "javascript:alert(1)",
    "https://sandbox.paypal.com.evil.example/",
    "https://evil@sandbox.paypal.com/",
    "http://sandbox.paypal.com/",
  ])
    assert.equal(safeApprovalUrl(url), null);
});

test("partial delivery uses integer contract prices and distinct published units", () => {
  assert.equal(payable(demoBatch, [...demoArtifacts, demoArtifacts[0]]), 4000);
  assert.equal(
    payable(
      demoBatch,
      demoArtifacts.map((a) => ({ ...a, published: false })),
    ),
    0,
  );
});
test("pending and unknown captures never become confirmed cash", () => {
  for (const state of ["PENDING", "UNKNOWN", "RESERVED"]) {
    const result = financialState([
      { kind: "CAPTURE", state, amount_minor: 4000 },
    ]);
    assert.notEqual(result.state, "CONFIRMED");
  }
});
test("refund operations do not create a settlement confirmation", () => {
  assert.equal(
    financialState([{ kind: "REFUND", state: "CONFIRMED" }]).state,
    "DRAFT",
  );
  assert.equal(
    financialState([
      { kind: "CAPTURE", state: "CONFIRMED", amount_minor: 4000 },
    ]).state,
    "CONFIRMED",
  );
});
test("zero delivery releases authorization without claiming a refund", () => {
  const result = financialState([
    { kind: "VOID", state: "CONFIRMED", amount_minor: 0 },
  ]);
  assert.equal(result.title, "Authorization released");
});
test("invalid, absent or expired reviews require a fresh approval", () => {
  assert.equal(approvalExpired(null), true);
  assert.equal(approvalExpired({ expires_at: "invalid" }), true);
  assert.equal(
    approvalExpired(
      { expires_at: "2026-11-09T00:00:00Z" },
      Date.parse("2026-11-09T00:00:00Z"),
    ),
    true,
  );
});
const preview = () => ({
  id: "review",
  currency: "USD",
  amount_minor: 4000,
  unit_ids: demoBatch.units.slice(0, 8).map((u) => u.id),
  action: "CAPTURE",
  expires_at: new Date(Date.now() + 45000).toISOString(),
});
test("settlement review rejects a changed price, currency or foreign unit", () => {
  assert.equal(validatePreview(preview(), demoBatch).amount_minor, 4000);
  for (const patch of [
    { amount_minor: 4001 },
    { currency: "EUR" },
    { unit_ids: ["foreign"] },
    { action: "VOID" },
  ])
    assert.throws(() => validatePreview({ ...preview(), ...patch }, demoBatch));
});
test("duplicate unit allocations cannot pass the review", () => {
  const p = preview();
  p.unit_ids.push(p.unit_ids[0]);
  assert.throws(() => validatePreview(p, demoBatch));
});
test("empty valid preview is a zero-amount void", () => {
  assert.equal(
    validatePreview(
      { ...preview(), unit_ids: [], amount_minor: 0, action: "VOID" },
      demoBatch,
    ).action,
    "VOID",
  );
});
