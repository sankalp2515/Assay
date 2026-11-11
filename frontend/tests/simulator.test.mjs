import test from "node:test";
import assert from "node:assert/strict";
import { DEMO_BATCH_ID, resetDemo, simulate } from "../src/demo/simulator.js";

const root = `/v1/batches/${DEMO_BATCH_ID}`;

test("walkthrough: investigate, restore the original, capture $40 of $50 once", async () => {
  resetDemo();
  let out = await simulate(root + "/outcomes");
  assert.equal(out.artifacts.length, 7);
  await assert.rejects(simulate(root + "/closure-preview", { body: {} }), /investigation/);

  const first = await simulate(root + "/investigate", { body: {} });
  assert.equal(first.provenance, "illustrative");
  assert.equal(first.assessment.actions[0].kind, "RESTORE_ACCESS");
  const ids = new Set(first.evidence.map((e) => e.id));
  assert.ok(first.assessment.citations.every((c) => ids.has(c.observation_id)));

  const review = await simulate(root + "/review");
  const hidden = review.artifacts.find((a) => !a.published);
  const receipt = await simulate(root + "/recover", {
    body: { artifact_id: hidden.id, assessment_id: first.id },
  });
  assert.equal(receipt.outcome, "VERIFIED");
  assert.equal((await simulate(root + "/investigation")).current, false);
  await assert.rejects(simulate(root + "/closure-preview", { body: {} }), /investigation/);

  const second = await simulate(root + "/investigate", {
    body: { refresh_reason: "Restored the original output." },
  });
  assert.equal(second.assessment.disposition, "READY_TO_CLOSE");
  const preview = await simulate(root + "/closure-preview", { body: {} });
  assert.equal(preview.amount_minor, 4000);
  assert.equal(preview.unit_ids.length, 8);
  await assert.rejects(
    simulate(root + "/approve", { body: { proposal_id: preview.id, approval_digest: "wrong" } }),
    /no longer matches/,
  );
  const body = { proposal_id: preview.id, approval_digest: preview.approval_digest };
  await simulate(root + "/approve", { body });
  await simulate(root + "/approve", { body });

  out = await simulate(root + "/outcomes");
  assert.equal(out.operations.length, 1);
  assert.equal(out.operations[0].amount_minor, 4000);
  const statement = await simulate(root + "/statement");
  assert.equal(statement.signed, false);
  assert.equal(statement.statement.not_taken_minor, 1000);
  assert.equal(statement.statement.clips.filter((c) => c.charged).length, 8);
  const impact = await simulate("/v1/operations/impact");
  assert.equal(impact.clips_recovered_without_rerender, 1);
  assert.equal(impact.never_taken_minor, 1000);
});
