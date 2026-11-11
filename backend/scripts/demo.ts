// One-command walkthrough of the recovery story. No keys, no network, no money.
// Everything runs in-process on fixture PayPal, fixture AI and a locally encoded test MP4.
// Run: npm run demo
import { harness } from "../test/harness.js";
import { dispatchOutbox } from "../src/core/transport.js";
import type { Json } from "../src/domain/contracts.js";
import { configuredInvestigator } from "../src/adapters/models.js";

const usd = (minor: unknown) => "$" + (Number(minor) / 100).toFixed(2);
const step = (n: number, title: string) => console.log(`\n${n}. ${title}`);
const say = (line: string) => console.log("   " + line);

process.env.PROVIDER_RERENDER_COST_MINOR ??= "40";
const realAi = process.argv.includes("--real-ai");
if (realAi) await import("./config.js");
console.log(
  realAi
    ? "Recovery-first settlement demo  [REAL GEMINI; fixture PayPal and fixture video]"
    : "Recovery-first settlement demo  [FIXTURE MODE: no real PayPal, AI or video provider]",
);
const h = await harness();
if (realAi) {
  const model = configuredInvestigator({ ...process.env, AI_ZERO_COST_ONLY: "true" });
  if (!model.available) throw new Error("--real-ai needs a confirmed free-tier Gemini key");
  h.contexts.investigation.model = model;
}
try {
  step(1, "Buyer orders 10 clips at $5 and approves up to $50 with PayPal");
  const b = await h.setup(10);
  say(`Batch ${b.id.slice(0, 8)}: 10 clips, authorization ceiling ${usd(b.ceiling_minor)} (fixture authorization).`);

  step(2, "The video provider runs");
  await h.seed(b, 7);
  const lost = await h.seed(b, 1, false, 7);
  say("Clips 1-7 rendered and were delivered.");
  say("Clip 8 rendered, but the delivery step was lost: the file exists, the buyer never got it.");
  say("Clips 9-10 failed at the provider. No output exists.");

  step(3, "Buyer writes in their own words");
  const message = "Clip 8, 9 and 10 never showed up, refund me everything";
  say(`"${message}"`);
  const support = (
    await h.request("/v1/batches/" + b.id + "/support", { category: "access", message }, "buyer")
  ).json<Json>();
  const reading = support.reading as Json;
  say(`AI reading (${String(reading.model)}): ${JSON.stringify((reading.interpretation as Json).claims)}`);
  for (const r of reading.resolutions as Json[]) say(`Rule decision, clip ${String(r.clip)}: ${String(r.outcome)}`);
  say(`Reply sent: ${String(reading.reply)}`);

  step(4, "Recover the original instead of paying to render it again");
  const investigation = (await h.request("/v1/batches/" + b.id + "/investigate", {})).json<Json>();
  const actions = ((investigation.assessment as Json).actions as Json[]).map((a) => a.kind);
  say(`AI investigation proposes: ${actions.join(", ")} (cited; rules check it before anything happens).`);
  const restored = (
    await h.request("/v1/batches/" + b.id + "/recover", {
      artifact_id: lost[0]!.id,
      assessment_id: investigation.id,
    })
  ).json<Json>();
  say(`Clip 8 restored and buyer retrieval verified: ${String(restored.outcome)}.`);

  step(5, "Merchant reviews the exact charge and PayPal captures once");
  const s = await h.settle(b);
  say(`Proposal: ${(s.permit.unit_ids as string[]).length} verified clips = ${usd(s.permit.amount_minor)}.`);
  const op = await s.execute();
  await s.execute(); // a double click or retry
  say(`Capture ${String(op.state)}; PayPal capture calls made: ${h.paypal.captures} (second click did nothing).`);
  say(`PayPal note to the buyer: "${String(h.paypal.captureDetails?.note_to_payer)}"`);
  await dispatchOutbox(h.contexts.payments, h.tenant);
  await dispatchOutbox(h.contexts.payments, h.tenant);

  step(6, "Buyer gets a signed delivery statement anyone can check");
  const st = (await h.request("/v1/batches/" + b.id + "/statement", undefined, "buyer")).json<Json>();
  const body = st.statement as Json;
  for (const c of body.clips as Json[])
    say(`Clip ${String(c.clip).padStart(2)}: ${c.charged ? "delivered, charged " + usd(c.price_minor) : "not delivered, not charged"}`);
  say(`Charged ${usd(body.charged_minor)}. Never taken: ${usd(body.not_taken_minor)} (released, not a refund).`);
  const ok = (await h.request("/v1/statements/verify", { jws: st.jws }, "buyer")).json<Json>();
  say(`Signature check: ${ok.valid ? "valid" : "INVALID"}. Changing any number breaks it.`);

  step(7, "What the merchant saw across the batch");
  const impact = (await h.request("/v1/operations/impact")).json<Json>();
  say(`Clips recovered without a re-render: ${String(impact.clips_recovered_without_rerender)}`);
  say(`Estimated re-render cost avoided: ${usd(impact.estimated_rerender_cost_avoided_minor)} (demo setting, not a measured price)`);
  say(`Authorized ${usd(impact.authorized_minor)}, charged ${usd(impact.charged_minor)}, never taken ${usd(impact.never_taken_minor)}.`);
  console.log("\nDone. AI read and proposed; rules and the merchant decided; PayPal moved exactly $40.");
} finally {
  await h.close();
}
