import "./config.js";
import { mkdir, writeFile } from "node:fs/promises";
import { PayPalSandbox } from "../src/adapters/paypal.js";

const paypal = new PayPalSandbox({
  clientId: process.env.PAYPAL_CLIENT_ID ?? "",
  secret: process.env.PAYPAL_CLIENT_SECRET ?? "",
  merchantId: process.env.PAYPAL_MERCHANT_ID ?? "",
  webhookId: process.env.PAYPAL_WEBHOOK_ID ?? "",
  returnUrl: process.env.PAYPAL_RETURN_URL ?? "http://localhost:4100/v1/paypal/return",
  cancelUrl: process.env.PAYPAL_CANCEL_URL ?? "http://localhost:4100/v1/paypal/cancel",
});

try {
  const connection = await paypal.checkAuthentication();
  const report = {
    timestamp: new Date().toISOString(),
    test: "actual PayPal Sandbox OAuth authentication",
    ...connection,
    transaction_created: false,
    authorization_capture_refund_verified: false,
    credentials_exposed: false,
  };
  await mkdir("evidence", { recursive: true });
  await writeFile("evidence/paypal-authentication.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch {
  console.log(JSON.stringify({ authenticated: false, environment: "sandbox", error: "PayPal authentication unavailable; no credential values printed" }));
  process.exitCode = 1;
}
