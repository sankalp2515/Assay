import "./config.js";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  PayPalSandbox,
  verifyMoney,
  refundReferencesCapture,
} from "../src/adapters/paypal.js";
import { id, digest, type Json } from "../src/domain/contracts.js";
const paypal = new PayPalSandbox({
  clientId: process.env.PAYPAL_CLIENT_ID ?? "",
  secret: process.env.PAYPAL_CLIENT_SECRET ?? "",
  merchantId: process.env.PAYPAL_MERCHANT_ID ?? "",
  webhookId: "",
  returnUrl: "http://localhost:4100/v1/paypal/return",
  cancelUrl: "http://localhost:4100/v1/paypal/cancel",
});
const file = ".local/paypal-lifecycle.json";
await mkdir(".local", { recursive: true });
let state: Record<string, Json>;
try {
  state = JSON.parse(await readFile(file, "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  state = {};
}
async function save() {
  await writeFile(file, JSON.stringify(state, null, 2), { mode: 0o600 });
}
async function write(name: string, effect: (key: string) => Promise<Json>) {
  if (state[name]?.result) return state[name]!.result as Json;
  if (state[name])
    throw new Error(
      "Unknown prior write; correlate original request before proceeding",
    );
  state[name] = { request_id: id(), state: "DISPATCHING" };
  await save();
  const result = await effect(String(state[name]!.request_id));
  state[name] = { ...state[name], state: "RETURNED", result };
  await save();
  return result;
}
function authorization(order: Json) {
  return (
    ((order.purchase_units as Json[])[0]!.payments as Json)
      .authorizations as Json[]
  )[0]!;
}
const mode = process.argv[2] ?? "status";
try {
  if (mode === "prepare") {
    for (const name of ["partial", "void"]) {
      state[name + "_batch"] ??= { id: id() };
      await save();
      await write(name + "_order", (key) =>
        paypal.createOrder(String(state[name + "_batch"]!.id), 5000, key),
      );
    }
  }
  if (mode === "settle") {
    const ids = ["partial", "void"].map((name) =>
      String((state[name + "_order"]!.result as Json).id),
    );
    for (const orderId of ids) {
      const order = await paypal.getOrder(orderId);
      if (!["APPROVED", "COMPLETED"].includes(String(order.status)))
        throw new Error("Buyer approval required for both sandbox orders");
    }
    const authorized = await write("partial_authorize", (key) =>
      paypal.authorizeOrder(ids[0]!, key),
    );
    const auth = authorization(authorized);
    const captured = await write("partial_capture", (key) =>
      paypal.capture(String(auth.id), 4000, key),
    );
    const capture = await paypal.getCapture(String(captured.id));
    // A resumed successful test may already have its deliberately issued refund.
    assert.equal(
      capture.status === "COMPLETED" ||
        (captured.status === "COMPLETED" &&
          !!state.partial_refund?.result &&
          ["PARTIALLY_REFUNDED", "REFUNDED"].includes(String(capture.status))),
      true,
    );
    assert.equal(
      verifyMoney(capture, 4000, process.env.PAYPAL_MERCHANT_ID!),
      true,
    );
    assert.equal(
      ((capture.supplementary_data as Json).related_ids as Json)
        .authorization_id,
      auth.id,
    );
    const refunded = await write("partial_refund", (key) =>
      paypal.refund(String(captured.id), 500, key),
    );
    const refund = await paypal.getRefund(String(refunded.id));
    assert.equal(refund.status, "COMPLETED");
    assert.equal(refundReferencesCapture(refund, String(captured.id)), true);
    assert.deepEqual(refund.amount, { currency_code: "USD", value: "5.00" });
    const voidAuthorized = await write("void_authorize", (key) =>
      paypal.authorizeOrder(ids[1]!, key),
    );
    const voidAuth = authorization(voidAuthorized);
    await write("void_release", (key) => paypal.void(String(voidAuth.id), key));
    const released = await paypal.getAuthorization(String(voidAuth.id));
    assert.equal(released.status, "VOIDED");
    const report = {
      at: new Date().toISOString(),
      provenance: "actual PayPal Sandbox adapter lifecycle",
      real_money: false,
      authorized_minor: 5000,
      captured_minor: 4000,
      unused_authorization_minor: 1000,
      actual_postcapture_refund_minor: 500,
      capture_status: capture.status,
      refund_status: refund.status,
      second_authorization_status: released.status,
      receipt_digests: [digest(capture), digest(refund), digest(released)],
      limitations: [
        "adapter-level test; not a full service/browser product workflow",
        "no real video generation or webhook delivery asserted",
      ],
    };
    await writeFile(
      "evidence/paypal-lifecycle.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
  } else {
    const orders = [];
    for (const name of ["partial", "void"]) {
      const result = state[name + "_order"]?.result as Json | undefined;
      if (result?.id) {
        const order = await paypal.getOrder(String(result.id));
        const links = result.links as Json[];
        orders.push({
          scenario: name,
          status: order.status,
          approval_url: links.find((l) =>
            ["payer-action", "approve"].includes(String(l.rel)),
          )?.href,
        });
      }
    }
    // Private local handoff, deliberately not printed into public logs.
    await writeFile(
      ".local/paypal-approvals.json",
      JSON.stringify(orders, null, 2),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        status: "sandbox_orders_prepared",
        orders: orders.map((o) => ({ scenario: o.scenario, status: o.status })),
        approvals: ".local/paypal-approvals.json",
      }),
    );
  }
} catch {
  console.error(
    "Sandbox lifecycle incomplete. Buyer approval, provider rejection or unknown write requires inspection. No credentials printed.",
  );
  process.exitCode = 1;
}
