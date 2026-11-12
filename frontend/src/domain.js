// Amounts arrive in the currency's smallest unit: cents for USD, whole yen for JPY.
const formatters = new Map();
function formatter(currency) {
  if (!formatters.has(currency)) {
    let f;
    try {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency });
    } catch {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
    }
    formatters.set(currency, [f, 10 ** f.resolvedOptions().maximumFractionDigits]);
  }
  return formatters.get(currency);
}
export const money = (minor, currency = "USD") => {
  const [f, scale] = formatter(currency || "USD");
  return f.format(minor / scale);
};
export function payable(batch, artifacts) {
  const published = new Set(
    artifacts.filter((a) => a.published).map((a) => a.unit_id),
  );
  return batch.units
    .filter((u) => published.has(u.id))
    .reduce((sum, u) => sum + u.price_minor, 0);
}
export function financialState(operations = []) {
  const settlement = operations.find((o) =>
    ["CAPTURE", "VOID"].includes(o.kind),
  );
  if (!settlement) return { state: "DRAFT", title: "Settlement draft" };
  if (settlement.state === "CONFIRMED")
    return {
      state: "CONFIRMED",
      title:
        settlement.kind === "VOID"
          ? "Authorization released"
          : "Capture confirmed",
      operation: settlement,
    };
  if (settlement.state === "UNKNOWN")
    return {
      state: "UNKNOWN",
      title: "Awaiting confirmation",
      operation: settlement,
    };
  if (["FAILED", "CANCELED"].includes(settlement.state))
    return {
      state: "FAILED",
      title: "Settlement needs attention",
      operation: settlement,
    };
  return {
    state: "PENDING",
    title: "Settlement processing",
    operation: settlement,
  };
}
export function paymentSummary(operations = []) {
  const sum = (kind, states) =>
    operations
      .filter((o) => o.kind === kind && states.includes(o.state))
      .reduce(
        (total, o) =>
          total + (Number.isSafeInteger(o.amount_minor) ? o.amount_minor : 0),
        0,
      );
  const captured = sum("CAPTURE", ["CONFIRMED"]);
  const refunded = sum("REFUND", ["CONFIRMED"]);
  const pendingRefund = sum("REFUND", [
    "RESERVED",
    "DISPATCHING",
    "PENDING",
    "UNKNOWN",
    "NEEDS_REVIEW",
  ]);
  return { captured, refunded, pendingRefund, net: captured - refunded };
}
export const readableState = (state = "UNKNOWN") =>
  state.toLowerCase().replaceAll("_", " ");
export function usdMinor(value) {
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(String(value)))
    throw Error("Enter a USD price with at most two decimal places.");
  const [dollars, cents = ""] = String(value).split(".");
  const amount = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
  if (amount < 1 || amount > 100000)
    throw Error("Price must be between $0.01 and $1,000.00.");
  return amount;
}
export function safeApprovalUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      ["www.sandbox.paypal.com", "sandbox.paypal.com"].includes(u.hostname) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function approvalExpired(preview, now = Date.now()) {
  return (
    !preview ||
    !Number.isFinite(Date.parse(preview.expires_at)) ||
    Date.parse(preview.expires_at) <= now
  );
}
export function validatePreview(preview, batch) {
  if (
    !preview ||
    !Array.isArray(preview.unit_ids) ||
    preview.currency !== batch.currency ||
    !Number.isInteger(preview.amount_minor) ||
    preview.amount_minor < 0 ||
    preview.amount_minor > batch.ceiling_minor ||
    new Set(preview.unit_ids).size !== preview.unit_ids.length ||
    approvalExpired(preview)
  )
    throw new Error(
      "The settlement review is invalid or expired. Refresh the batch before continuing.",
    );
  const eligible = batch.units.filter((u) => preview.unit_ids.includes(u.id));
  if (
    eligible.length !== preview.unit_ids.length ||
    eligible.reduce((n, u) => n + u.price_minor, 0) !== preview.amount_minor ||
    preview.action !== (eligible.length ? "CAPTURE" : "VOID")
  )
    throw new Error(
      "The settlement amount does not match the selected contract units.",
    );
  return preview;
}
export const demoBatch = {
  id: "demo-coastal-024",
  title: "Coastal collection",
  label: "Batch 024",
  currency: "USD",
  ceiling_minor: 5000,
  units: Array.from({ length: 10 }, (_, i) => ({
    id: `demo-unit-${i + 1}`,
    price_minor: 500,
  })),
  terms: {
    technical: { min_seconds: 4, max_seconds: 10, min_height: 720 },
    retention_days: 7,
  },
  created_at: "2026-11-09T10:14:00Z",
  retention_until: "2026-11-16T10:14:00Z",
  state: "INVESTIGATED",
};
export const demoArtifacts = demoBatch.units.slice(0, 8).map((u, i) => ({
  id: `demo-artifact-${i + 1}`,
  unit_id: u.id,
  published: true,
  state: "STORED",
  width: 1920,
  height: 1080,
  duration: 6,
}));

const CLIENT_ID = /^[A-Za-z0-9_-]{20,128}$/;
const CURRENCY = /^[A-Z]{3}$/;

/** Returns the SDK URL, or null when the config is not a usable Sandbox config. */
export function paypalSdkUrl(config, currency = "USD") {
  if (!config || config.environment !== "sandbox") return null;
  if (!CLIENT_ID.test(String(config.client_id || ""))) return null;
  if (config.intent && config.intent !== "authorize") return null;
  currency = String(currency || "USD");
  if (!CURRENCY.test(currency)) return null;
  if (Array.isArray(config.currencies) && !config.currencies.includes(currency)) return null;
  const q = new URLSearchParams({
    "client-id": config.client_id,
    intent: "authorize",
    currency,
    components: "buttons",
    // This approval is a hold, not a purchase: PayPal's last button reads "Continue".
    commit: "false",
  });
  return `https://www.paypal.com/sdk/js?${q}`;
}
