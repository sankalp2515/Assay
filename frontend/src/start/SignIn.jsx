// Sign-in, for real. Three ways in, each one working on the hosted Sandbox:
// 1. a merchant account: sign in with the operator key issued at sign-up,
// 2. a private Sandbox workspace for anyone trying the product (24 hours),
// 3. the merchant's own identity provider (OIDC), shown only when one is configured.
import { useState } from "react";
import { ArrowRightIcon, KeyIcon, WarningIcon } from "@phosphor-icons/react";
import { accountLogin, demoLoginAvailable, ssoAvailable, LIVE_DEMO_HREF } from "../api.js";
import { withPayPal } from "../ui/PayPalLogo.jsx";
import "./start.css";

export async function signInWithKey(key) {
  const out = await accountLogin(key);
  // The session cookie is set; reload so every screen reads the merchant's workspace.
  location.assign(out.return_to || "/#/start");
  location.reload();
}

export function SignIn() {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const live = demoLoginAvailable();
  const sso = ssoAvailable();

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await signInWithKey(key.trim());
    } catch (err) {
      setError(err?.message || "Sign-in failed. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="signin-grid">
      <form className="sheet signin-card" onSubmit={submit} aria-labelledby="signin-merchant">
        <div className="sheet-body">
          <p className="eyebrow">Merchant account</p>
          <h2 id="signin-merchant">Sign in with your account key</h2>
          <p>Use the operator key you were given when you created your Sandbox account. It opens your own workspace, which keeps your deliveries between visits.</p>
          <label className="signin-field">
            <span>Operator key</span>
            <input
              type="password"
              name="api_key"
              autoComplete="current-password"
              spellCheck={false}
              placeholder="assay_sk_…"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
              minLength={20}
            />
          </label>
          {error && (
            <p className="flow-notice" role="alert"><WarningIcon size={15} aria-hidden="true" /> {error}</p>
          )}
          <button className="btn btn-proof" disabled={busy || key.trim().length < 20}>
            <KeyIcon size={16} aria-hidden="true" />{busy ? "Checking the key…" : "Sign in"}
          </button>
          <p className="signin-note">The key is checked by the server and never stored in this browser. Integration keys cannot sign in to the workspace.</p>
          <p className="signin-note">No account yet? <a className="text-link" href="#/signup">Create a Sandbox merchant account</a>.</p>
        </div>
      </form>
      <div className="signin-side">
        {live && (
          <section className="sheet signin-card" aria-labelledby="signin-try">
            <div className="sheet-body">
              <p className="eyebrow">Trying Assay</p>
              <h2 id="signin-try">Open a private Sandbox workspace</h2>
              <p>No account needed. You get your own merchant and buyer for 24 hours and run the full job with test money.</p>
              <a className="btn btn-outline" href={LIVE_DEMO_HREF}>{withPayPal("Run it live on PayPal Sandbox")}<ArrowRightIcon size={15} aria-hidden="true" /></a>
            </div>
          </section>
        )}
        {sso && (
          <section className="sheet signin-card" aria-labelledby="signin-sso">
            <div className="sheet-body">
              <p className="eyebrow">Company sign-in</p>
              <h2 id="signin-sso">Continue with your identity provider</h2>
              <a className="btn btn-outline" href={`/api/login?returnTo=${encodeURIComponent("/#/batches")}`}>Continue</a>
            </div>
          </section>
        )}
        <section className="sheet signin-card" aria-labelledby="signin-buyer">
          <div className="sheet-body">
            <p className="eyebrow">Buying a delivery?</p>
            <h2 id="signin-buyer">Use your private delivery link</h2>
            <p>Your studio sends a link that opens your agreement, the PayPal approval and your clips. Buyers never need an account.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
