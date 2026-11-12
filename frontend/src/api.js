const intents = new Map();
try {
  for (const [key, value] of JSON.parse(
    sessionStorage.getItem("pvd-intents") || "[]",
  ))
    intents.set(key, value);
} catch {
  /* Storage can be unavailable in private browsing. */
}
let gateway = null;
// Illustrative walkthrough: requests are answered by an isolated in-browser simulator.
// Nothing in demo mode reaches a backend, PayPal or a model.
let demoMode = false;
export function setDemoMode(value) {
  demoMode = !!value;
}
export const isDemoMode = () => demoMode;
let demoLoginOffered = false;
export const demoLoginAvailable = () => demoLoginOffered;
let ssoOffered = false;
export const ssoAvailable = () => ssoOffered;
// Merchant sign-in with the account's operator key. The gateway checks it with Commerce,
// keeps only a cookie session, and opens the merchant's own workspace.
export async function accountLogin(apiKey) {
  const res = await fetch("/api/account-login", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.message || "Sign-in failed. Try again.", res.status, data.code);
  return data;
}
export const LIVE_DEMO_HREF = `/api/demo-login?as=operator&returnTo=${encodeURIComponent("/#/start")}`;
export async function currentSession() {
  const res = await fetch("/api/session", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!res.ok || !res.headers.get("Content-Type")?.includes("application/json")) {
    // A signed-out visitor on a hosted Sandbox: the gateway says whether it offers a
    // one-click demo workspace, so the Start page can link straight to it.
    if (res.status === 401) {
      const info = await res.json().catch(() => ({}));
      demoLoginOffered = info.demo_login === true;
      ssoOffered = info.sso === true;
    }
    return null;
  }
  gateway = await res.json();
  return gateway;
}
export async function buyerDirectory() {
  const res = await fetch(
    import.meta.env.DEV ? "/__local/profile" : "/api/directory",
    { cache: "no-store", credentials: "same-origin" },
  );
  if (!res.ok)
    throw new ApiError(
      "Buyer access must be provisioned before creating an agreement.",
      res.status,
    );
  const data = await res.json();
  if (!Array.isArray(data.buyers))
    throw Error("Buyer directory is unavailable.");
  return data;
}
export async function signOut() {
  if (gateway)
    await fetch("/api/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-CSRF-Token": gateway.csrf },
    });
  gateway = null;
  forgetSession();
}
export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
let session = null;
export function forgetSession() {
  session = null;
  intents.clear();
  try {
    sessionStorage.removeItem("pvd-intents");
  } catch {
    /* Optional storage. */
  }
}
async function token(role) {
  if (!import.meta.env.DEV)
    throw new ApiError(
      "Sign in to access your delivery. Local identities are unavailable in this build.",
      401,
      "session_required",
    );
  if (!session || session.until < Date.now()) {
    const res = await fetch("/__local/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (
      !res.ok ||
      !res.headers.get("Content-Type")?.includes("application/json")
    )
      throw new ApiError(
        "Local session unavailable. Start the backend and use this preview on localhost.",
        res.status,
      );
    session = { ...(await res.json()), until: Date.now() + 90000 };
  }
  return session[role];
}
export async function request(
  path,
  { role = "operator", body, intent, signal } = {},
) {
  if (demoMode) {
    const { simulate } = await import("./demo/simulator.js");
    return simulate(path, { role, body });
  }
  if (!import.meta.env.DEV && !gateway) {
    await currentSession();
    if (!gateway)
      throw new ApiError(
        "Your session expired. Sign in to reopen this delivery.",
        401,
        "session_required",
      );
  }
  let key;
  if (body !== undefined) {
    const raw = `${role}:${path}:${intent || JSON.stringify(body)}`;
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(raw),
    );
    const identity = [...new Uint8Array(hash)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    if (!intents.has(identity)) intents.set(identity, crypto.randomUUID());
    try {
      sessionStorage.setItem(
        "pvd-intents",
        JSON.stringify([...intents].slice(-150)),
      );
    } catch {
      /* Server idempotency remains authoritative. */
    }
    key = intents.get(identity);
  }
  const send = async () =>
    fetch("/api/commerce" + path, {
      method: body === undefined ? "GET" : "POST",
      signal: signal || AbortSignal.timeout(20000),
      cache: "no-store",
      headers: {
        ...(gateway
          ? { "X-CSRF-Token": gateway.csrf }
          : { Authorization: "Bearer " + (await token(role)) }),
        ...(body !== undefined
          ? { "Content-Type": "application/json", "Idempotency-Key": key }
          : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  let res = await send();
  if (res.status === 401) {
    if (gateway)
      throw new ApiError(
        "Your session expired. Sign in again to reopen this batch.",
        401,
        "session_expired",
      );
    session = null;
    res = await send();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new ApiError(
      data.message ||
        "The service could not complete this request. Your current work is preserved.",
      res.status,
      data.code,
    );
  return data;
}
export async function contentBlob(artifact, deliveryToken, signal) {
  if (demoMode) {
    const { demoContent } = await import("./demo/simulator.js");
    return demoContent(artifact, signal);
  }
  if (
    !/^\/v1\/artifacts\/[a-f0-9-]+\/content$/i.test(artifact.content_path || "")
  )
    throw new ApiError("This file has no valid delivery route.", 422);
  const res = await fetch("/api/delivery" + artifact.content_path, {
    cache: "no-store",
    signal,
    headers: { Authorization: "Bearer " + deliveryToken },
  });
  if (!res.ok)
    throw new ApiError(
      res.status === 401
        ? "File access expired. Refresh delivery to continue."
        : "This file is not currently retrievable. Refresh delivery or ask the merchant for help.",
      res.status,
    );
  return res.blob();
}

/** Creates a merchant account. Public route: no session, and never retried here. */
export async function signup(body) {
  if (demoMode)
    throw new ApiError("The walkthrough has no accounts. Connect services to sign up.", 409, "demo");
  const res = await fetch("/api/commerce/v1/signup", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.timeout(30000),
    headers: {
      "Content-Type": "application/json",
      ...(gateway ? { "X-CSRF-Token": gateway.csrf } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.message || "", res.status, data.code);
  return data;
}
