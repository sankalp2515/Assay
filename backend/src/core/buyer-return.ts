// Where the buyer's browser lands after PayPal approval or cancellation.
// PayPal redirects to the Commerce return route with `?batch=<id>` (added when the order
// is created). If BUYER_RETURN_BASE is configured, that route sends the buyer back to the
// buyer agreement page, where the authenticated check confirms authorization. The redirect
// itself never changes payment state, and it forwards nothing PayPal added (token, PayerID).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

export function buyerReturnBase(raw = process.env.BUYER_RETURN_BASE ?? "") {
  if (!raw) return undefined;
  const url = new URL(raw);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.includes(url.hostname)))
    throw new Error("BUYER_RETURN_BASE must be https (http only on loopback)");
  if (url.username || url.password || url.search || url.hash)
    throw new Error("BUYER_RETURN_BASE must be a plain origin or path");
  return url.origin + url.pathname.replace(/\/+$/, "");
}

export function buyerReturnLocation(batch: unknown, base = buyerReturnBase()) {
  if (!base || typeof batch !== "string" || !UUID.test(batch)) return undefined;
  return base + "/#/buyer/" + batch.toLowerCase() + "/agreement";
}

// Adds the batch id to a configured PayPal return or cancel URL.
export function withBatch(url: string, batchId: string) {
  const u = new URL(url);
  u.searchParams.set("batch", batchId);
  return u.toString();
}
