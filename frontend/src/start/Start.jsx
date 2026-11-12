// "Start here": the whole job in order, for someone who has never seen the product.
// Every step state is read from the delivery record; nothing here is assumed done.
import { useEffect, useState } from "react";
import { ArrowRightIcon, CheckIcon, CopyIcon, WarningIcon } from "@phosphor-icons/react";
import { request, signup, demoLoginAvailable, LIVE_DEMO_HREF } from "../api.js";
import { money } from "../domain.js";
import { journeySteps, clipLinks } from "../ui/delivery-view.js";
import "./start.css";
import { withPayPal } from "../ui/PayPalLogo.jsx";
import { signInWithKey } from "./SignIn.jsx";

const ENV_COPY = {
  demo: ["Illustrative walkthrough", "Example records answered inside this page. No services, no PayPal, no money."],
  fixture: ["Test fixtures", "Real screens and services with simulated PayPal and AI. No PayPal account needed."],
  sandbox: ["PayPal Sandbox", "Real PayPal test orders and a hosted model. Test money only, never a real charge."],
  unverified: ["Not connected", "This page cannot reach the services, so only the walkthrough is available."],
};

function useBatches(envKind) {
  const [state, setState] = useState({ loading: true, items: [], error: null });
  useEffect(() => {
    let live = true;
    setState({ loading: true, items: [], error: null });
    request("/v1/batches?limit=20")
      .then((d) => live && setState({ loading: false, items: d.items || [], error: null }))
      .catch((error) => live && setState({ loading: false, items: [], error }));
    return () => {
      live = false;
    };
  }, [envKind]);
  return state;
}

function useBatch(id, envKind, withReview) {
  const [batch, setBatch] = useState(null);
  const [review, setReview] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    if (!id) {
      setBatch(null);
      setReview(null);
      return;
    }
    request(`/v1/batches/${encodeURIComponent(id)}`)
      .then((b) => live && setBatch(b))
      .catch(() => live && setBatch(null));
    if (withReview)
      request(`/v1/batches/${encodeURIComponent(id)}/review`)
        .then((r) => live && setReview(r))
        .catch(() => live && setReview(null));
    return () => {
      live = false;
    };
  }, [id, envKind, tick]);
  // The job moves forward in other screens; reread when the visitor comes back.
  useEffect(() => {
    const again = () => document.visibilityState === "visible" && setTick((n) => n + 1);
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, []);
  return { batch, review, reread: () => setTick((n) => n + 1) };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Hosted Sandbox demo: one visitor plays buyer and merchant, so a step for the other
// role first switches the demo sign-in and then lands on the step's screen.
function stepHref(step, demoLogin, role) {
  if (!demoLogin || step.who === (role === "buyer" ? "buyer" : "merchant")) return `#${step.to}`;
  const as = step.who === "buyer" ? "buyer" : "operator";
  return `/api/demo-login?as=${as}&returnTo=${encodeURIComponent("/#" + step.to)}`;
}

export function Start({ envKind, demo, openDemo, connect, canConnect, demoLogin = false, role = "operator" }) {
  const list = useBatches(envKind);
  const open = list.items.filter((b) => b.state !== "CLOSED");
  const [chosen, setChosen] = useState("");
  // Right after a live sign-in the list can still hold the walkthrough's example; never
  // ask the real services for it.
  const pick = chosen || open[0]?.id || list.items[0]?.id || "";
  const id = envKind !== "demo" && pick.startsWith("demo-") ? "" : pick;
  const { batch, review, reread } = useBatch(id, envKind, demoLogin && role !== "buyer");
  const [provider, setProvider] = useState({ state: "idle", note: "" });
  const [ownClips, setOwnClips] = useState("");
  const links = clipLinks(ownClips);
  useEffect(() => {
    setProvider({ state: "idle", note: "" });
    setOwnClips("");
  }, [id]);
  const tasks = review?.attempts?.length || 0;
  const archived = review?.artifacts?.length || 0;
  const steps = batch
    ? journeySteps(batch, { demoProvider: demoLogin && provider.state !== "off", hasTasks: tasks > 0 })
    : [];
  async function runProvider() {
    setProvider({ state: "running", note: "" });
    try {
      const out = await request(`/v1/demo/batches/${encodeURIComponent(id)}/simulate-provider`, {
        body: links.urls.length ? { clip_urls: links.urls } : {},
        intent: `demo-provider:${id}`,
      });
      setProvider({
        state: "archiving",
        note: [out.label, out.clips_from && `Clips: ${out.clips_from}.`, links.urls.length && "A link that fails Assay's checks appears as a quarantined file, not as a delivered clip."].filter(Boolean).join(" "),
      });
      // Archiving runs in the background on the server; reread a few times.
      for (let i = 0; i < 12; i++) {
        await wait(2500);
        reread();
      }
      setProvider((p) => ({ ...p, state: "done" }));
    } catch (e) {
      if (e.code === "demo_disabled") setProvider({ state: "off", note: "The demo provider is not enabled on this deployment. Clips appear when provider jobs are registered." });
      else if (e.status === 409) {
        reread();
        setProvider({ state: "done", note: "" });
      } else setProvider({ state: "idle", note: e.message || "The demo provider could not be started. Nothing was charged." });
    }
  }
  const next = steps.find((s) => s.state === "next");
  const [envTitle, envNote] = ENV_COPY[envKind] || ENV_COPY.unverified;

  return (
    <>
      <section className="start-ways" aria-label="Ways to try Assay">
        <article className="sheet start-way">
          <p className="eyebrow">01 · Watch</p>
          <h2>Follow one recovery</h2>
          <p>Example records answered inside this page. Nothing real is called and no money moves.</p>
          {demo ? (
            <p className="start-here"><CheckIcon size={14} weight="bold" aria-hidden="true" />You are in the walkthrough</p>
          ) : (
            <button className="btn btn-outline" onClick={openDemo}>Open the walkthrough</button>
          )}
        </article>
        <article className="sheet start-way" data-current={!demo || undefined}>
          <p className="eyebrow">02 · Run</p>
          <h2>Do the job yourself</h2>
          {demo ? (
            <p>Connected services run every step for real: test fixtures with no accounts, or PayPal Sandbox with test money.</p>
          ) : (
            <p><strong>{envTitle}.</strong> {envNote}</p>
          )}
          {demo && canConnect && <button className="btn btn-outline" onClick={connect}>Use connected services</button>}
          {demo && !canConnect && demoLoginAvailable() && (
            <a className="btn btn-proof" href={LIVE_DEMO_HREF}>{withPayPal("Run it live on PayPal Sandbox")}</a>
          )}
          {!demo && <p className="start-here"><CheckIcon size={14} weight="bold" aria-hidden="true" />Connected. The steps below are live</p>}
        </article>
        <article className="sheet start-way">
          <p className="eyebrow">03 · Integrate</p>
          <h2>Use your own account</h2>
          <p>Create a Sandbox merchant account and get an API key for your server.</p>
          <a className="btn btn-outline" href="#/signup">Create an account</a>
        </article>
      </section>

      <section className="sheet start-journey" aria-labelledby="journey-title">
        <header className="sheet-head">
          <div>
            <p className="eyebrow">The job, in order</p>
            <h2 id="journey-title">{batch ? batch.title || "Video delivery" : "One paid delivery, start to finish"}</h2>
          </div>
          {list.items.length > 1 && (
            <label className="start-pick">
              <span className="eyebrow">Delivery</span>
              <select value={id} onChange={(e) => setChosen(e.target.value)}>
                {list.items.map((b) => (
                  <option key={b.id} value={b.id}>
                    {(b.title || "Delivery") + " · " + b.id.slice(0, 8) + (b.state === "CLOSED" ? " · settled" : "")}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>

        {list.loading && <p className="start-empty" role="status">Reading the delivery records…</p>}
        {!list.loading && list.error && (
          <div className="start-empty">
            <p><WarningIcon size={16} aria-hidden="true" /> The services are not reachable from this page.</p>
            <p>Open the walkthrough above, or start the services on your machine as shown below.</p>
          </div>
        )}
        {!list.loading && !list.error && !list.items.length && (
          <div className="start-empty">
            <p>No delivery exists yet.</p>
            <p>A delivery starts as an agreement for a buyer. Clips appear once your video provider's jobs are registered against it.</p>
            <a className="btn btn-proof" href="#/new">Create an agreement</a>
          </div>
        )}

        {batch && (
          <>
            <p className="start-terms num">
              {batch.units?.length || 0} clips at {money(batch.units?.[0]?.price_minor || 0, batch.currency)} · up to {money(batch.ceiling_minor, batch.currency)} · <span className="source">{batch.id}</span>
            </p>
            {envKind === "sandbox" && steps[1]?.state !== "done" && (
              <p className="flow-notice">
                Step 2 opens PayPal Sandbox. Sign in there with a Sandbox personal (buyer) test account from developer.paypal.com. Assay never sees that password.
              </p>
            )}
            <ol className="start-steps">
              {steps.map((s, i) => (
                <li key={s.key} data-state={s.state}>
                  <span className="start-node" aria-hidden="true">{s.state === "done" ? <CheckIcon size={13} weight="bold" /> : i + 1}</span>
                  <div className="start-step-body">
                    <p className="start-step-title">
                      <strong>{withPayPal(s.title)}</strong>
                      <span className="start-who" data-who={s.who}>{s.who === "buyer" ? "Buyer" : "Merchant"}</span>
                      <span className="visually-hidden">{s.state === "done" ? ", done" : s.state === "next" ? ", next" : ", later"}</span>
                    </p>
                    <p>{s.detail}</p>
                    {s.state === "next" && s.key === "provider" && provider.state === "idle" && (
                      <details className="start-own">
                        <summary>Use your own clips (optional)</summary>
                        <label htmlFor="own-clips">Direct .mp4 links, one per line, up to three</label>
                        <textarea
                          id="own-clips"
                          rows="3"
                          spellCheck="false"
                          autoComplete="off"
                          placeholder="https://…/clip.mp4"
                          value={ownClips}
                          aria-describedby="own-clips-help"
                          aria-invalid={links.error ? "true" : undefined}
                          onChange={(e) => setOwnClips(e.target.value)}
                        />
                        <p id="own-clips-help" className="field-help">
                          Your clip links are fetched and checked by Assay like provider output. Use direct .mp4 links. Leave this empty to use the pre-generated clips.
                        </p>
                        {links.error && <p className="inline-error" role="alert">{links.error}</p>}
                      </details>
                    )}
                  </div>
                  {s.state === "next" && s.key === "provider" ? (
                    <button className="btn btn-proof" disabled={provider.state !== "idle" || !!links.error} onClick={runProvider}>
                      {provider.state === "idle" ? (links.urls.length ? `Run it with ${links.urls.length === 1 ? "your clip" : `your ${links.urls.length} clips`}` : s.action) : `Archiving… ${archived} stored`}
                    </button>
                  ) : s.state === "next" ? (
                    <a className="btn btn-proof" href={stepHref(s, demoLogin, role)}>{s.action}<ArrowRightIcon size={14} aria-hidden="true" /></a>
                  ) : s.state === "done" ? (
                    <a className="text-link" href={stepHref(s, demoLogin, role)}>View</a>
                  ) : (
                    <span className="start-later">After step {i}</span>
                  )}
                </li>
              ))}
            </ol>
            {provider.note && <p className="flow-notice" role="status">{provider.note}</p>}
            {demoLogin && <p className="start-done">You play both sides: buyer steps switch to your test buyer, merchant steps switch back.</p>}
            {!next && <p className="start-done">This delivery is settled. Start the services again for a fresh one, or pick another delivery above.</p>}
          </>
        )}
      </section>

      <section className="sheet start-local" aria-labelledby="local-title">
        <header className="sheet-head"><h2 id="local-title">Run it on your machine</h2></header>
        <div className="sheet-body">
          <p>From the <code>frontend</code> folder, after <code>npm ci</code> in <code>backend</code> and <code>frontend</code> and <code>npm run provision</code> in <code>backend</code>:</p>
          <dl className="start-commands">
            <div>
              <dt><code>npm run demo:ui</code></dt>
              <dd>Test fixtures. No keys, no PayPal account, no network.</dd>
            </div>
            <div>
              <dt><code>npm run demo:ui -- --sandbox</code></dt>
              <dd>Real PayPal Sandbox and a hosted model. Needs your own Sandbox app credentials and model key in <code>backend/.env</code>. Clips are a seeded test clip, not provider output.</dd>
            </div>
          </dl>
          <p className="plain-note">Either command prints the address to open and prepares one delivery with a lost clip, so every step above has something to act on.</p>
        </div>
      </section>
    </>
  );
}

const SNIPPET = `import { Assay } from "@assay/node";

const assay = new Assay({ apiKey: process.env.ASSAY_API_KEY, baseUrl: "https://your-assay-host" });

// 1. Your buyer checks out: open a delivery (idempotent on your order id).
const batch = await assay.batches.create(
  { buyer_id, unit_count: 10, unit_price_minor: 500, currency: "USD", prompt },
  "order-8812",
);

// 2. Your provider accepts a job: register it, and Assay archives the output.
await assay.batches.registerTask(batch.id, { unit_id, source: "replicate", provider_task_id }, "unit-3-" + provider_task_id);

// 3. Give the buyer's browser a 30-minute token for the PayPal approval page.
const { buyer_token } = await assay.buyerSessions.create({ batch_id: batch.id, buyer_id }, "session-" + batch.id);`;

function signupMessage(e) {
  if (e.code === "signup_closed") return "Sign-up is not open on this deployment. Ask the operator for access, or run the services yourself.";
  if (e.code === "invite_required") return "This deployment needs a valid invite code.";
  if (e.code === "account_exists") return "An account with this email already exists. Its key was shown when it was created and cannot be shown again.";
  if (e.status === 429) return "Too many sign-ups from here. Try again in an hour.";
  if ([401, 404].includes(e.status)) return "This deployment does not offer sign-up from the browser.";
  return e.message || "The account could not be created. Nothing was saved.";
}

export function Signup({ demo }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [account, setAccount] = useState(null);
  const [copied, setCopied] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    const invite = String(f.get("invite") || "").trim();
    setBusy(true);
    setError("");
    try {
      setAccount(
        await signup({
          merchant_name: String(f.get("name") || "").trim(),
          email: String(f.get("email") || "").trim(),
          ...(invite ? { invite_code: invite } : {}),
        }),
      );
    } catch (err) {
      setError(signupMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (account)
    return (
      <div className="start-signup">
        <section className="sheet" aria-labelledby="key-title">
          <header className="sheet-head">
            <div>
              <p className="eyebrow">Account created · Sandbox</p>
              <h2 id="key-title">{account.merchant_name}</h2>
            </div>
          </header>
          <div className="sheet-body">
            {account.api_key ? (
              <>
                <p><strong>Copy your API key now.</strong> It is shown once and is not kept in this browser.</p>
                <div className="start-key">
                  <code className="num">{account.api_key}</code>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => navigator.clipboard?.writeText(account.api_key).then(() => setCopied(true)).catch(() => setCopied(false))}
                  >
                    <CopyIcon size={14} aria-hidden="true" />{copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="flow-notice">This key can approve captures. Keep it on your server, in an environment variable. Never put it in a web page or a mobile app.</p>
                <div className="start-key-actions">
                  <button className="btn btn-proof" onClick={() => signInWithKey(account.api_key).catch((err) => setError(err?.message || "Sign-in failed."))}>Sign in to my workspace</button>
                  <button className="btn btn-outline" onClick={() => setAccount({ ...account, api_key: null })}>I have stored it</button>
                </div>
                {error && <p className="flow-notice" role="alert">{error}</p>}
              </>
            ) : (
              <p className="start-here"><CheckIcon size={14} weight="bold" aria-hidden="true" />The key is no longer shown. If it is lost, create a new key with the API and revoke this one.</p>
            )}
            <dl className="start-facts num">
              <div><dt>Scope</dt><dd>{account.api_key_scope}</dd></div>
              <div><dt>Environment</dt><dd>{account.environment || "sandbox"}</dd></div>
              <div><dt>Tenant</dt><dd>{account.tenant_id}</dd></div>
            </dl>
          </div>
        </section>
        <section className="sheet" aria-labelledby="next-title">
          <header className="sheet-head"><h2 id="next-title">From your server</h2></header>
          <div className="sheet-body">
            <p>The Node client is in <code>backend/sdk</code> of the repository; it is not on npm yet.</p>
            <pre className="start-code"><code>{SNIPPET}</code></pre>
          </div>
        </section>
      </div>
    );

  return (
    <div className="start-signup">
      <form className="sheet start-form" onSubmit={submit}>
        <div className="sheet-body">
          {demo && !demoLoginAvailable() && <p className="flow-notice">You are in the illustrative walkthrough, which has no accounts. Connect services to sign up.</p>}
          <label>
            <span>Business name</span>
            <input name="name" required minLength={2} maxLength={80} autoComplete="organization" />
          </label>
          <label>
            <span>Work email</span>
            <input name="email" type="email" required maxLength={200} autoComplete="email" />
          </label>
          <details open={demoLoginAvailable() || undefined}>
            <summary>Invite code</summary>
            <label>
              <span>Invite code</span>
              <input name="invite" maxLength={200} autoComplete="off" />
            </label>
          </details>
          {error && <p className="inline-banner" data-tone="failed" role="alert">{error}</p>}
          <button className="btn btn-proof btn-lg" disabled={busy || (demo && !demoLoginAvailable())}>{busy ? "Creating the account…" : "Create Sandbox account"}</button>
          <p className="plain-note">Sandbox only. No live payments are possible with this account.</p>
        </div>
      </form>
      <aside className="start-aside">
        <p className="eyebrow">What you get</p>
        <ul>
          <li>Your own data scope, separate from every other merchant.</li>
          <li>One API key for your server, shown once.</li>
          <li>Short-lived buyer tokens, so your key never reaches a browser.</li>
        </ul>
        <a className="text-link" href="#/start">Back to Start here</a>
      </aside>
    </div>
  );
}
