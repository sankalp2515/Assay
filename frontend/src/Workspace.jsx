import { Suspense, lazy, useEffect, useState } from "react";
import { PayPalButton, paypalSdkUrl } from "./buyer/PayPalButton.jsx";
import { Landing } from "./landing/Landing.jsx";

// The public page loads first; each workspace area loads when it is opened.
const named = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const CaseWorkspace = named(() => import("./case/CaseWorkspace.jsx"), "CaseWorkspace");
const BuyerDelivery = named(() => import("./buyer/BuyerDelivery.jsx"), "BuyerDelivery");
const Start = named(() => import("./start/Start.jsx"), "Start");
const Signup = named(() => import("./start/Start.jsx"), "Signup");

// AG Studio is large; it loads only when the dashboard is opened.
const Dashboard = lazy(() => import("./ops/Dashboard.jsx"));
import { DEMO_BATCH_ID } from "./demo/simulator.js";
import {
  currentSession,
  demoLoginAvailable,
  request,
  signOut,
  buyerDirectory,
  setDemoMode,
} from "./api.js";
import {
  demoBatch,
  demoArtifacts,
  money,
  paymentSummary,
  readableState,
  safeApprovalUrl,
  usdMinor,
} from "./domain.js";
import "./workspace.css";
import "./ui/workflows.css";
import { investigateBatch } from "./investigation.js";
import {
  ArrowSquareOutIcon,
  MagnifyingGlassIcon,
  FilmStripIcon,
  PlusIcon,
  PlugsConnectedIcon,
  ShieldCheckIcon,
  SparkleIcon,
  CreditCardIcon,
  ArrowClockwiseIcon,
} from "@phosphor-icons/react";
import { coarseStations, deliveryStage, filterDeliveries } from "./ui/delivery-view.js";
import { ProofLine } from "./ui/ProofLine.jsx";
import { ProductShell } from "./ui/ProductShell.jsx";
import { Chip, LoadingCard, Reference, stamp } from "./ui/kit.jsx";
import { PayPalLogo } from "./ui/PayPalLogo.jsx";

const OP_TONE = {
  CONFIRMED: "confirmed",
  UNKNOWN: "unknown",
  FAILED: "failed",
  CANCELED: "failed",
};
const opTone = (op) =>
  op.state === "CONFIRMED" && op.kind === "REFUND"
    ? "refunded"
    : OP_TONE[op.state] || "pending";
const OUTCOME = {
  ALREADY_AVAILABLE: ["Already available", "confirmed"],
  RECOVERY_QUEUED: ["Original exists, restore it", "pending"],
  NOT_CHARGED: ["Not delivered, not charged", "neutral"],
  MERCHANT_REVIEW: ["Needs merchant review", "unknown"],
  STATEMENT: ["Answered from the statement", "authorized"],
};
function Reading({ reading }) {
  if (!reading) return null;
  if (reading.state !== "READ")
    return (
      <p className="reading-wait">
        <Chip tone="unknown" quiet>
          Not read by AI yet
        </Chip>{" "}
        The message is saved. Rules will answer once the reading is available.
      </p>
    );
  const claims = reading.interpretation?.claims || [];
  return (
    <div className="reading">
      <div className="reading-part" data-kind="ai">
        <h4>
          AI reading{" "}
          <span>
            {reading.provenance === "real"
              ? reading.model
              : "fixture reader, not a real model"}
          </span>
        </h4>
        {claims.map((c, i) => (
          <p key={i}>
            Clips {c.clip_numbers?.join(", ") || "not stated"}:{" "}
            {readableState(c.issue)}. Quoted: <q>{c.quote}</q>
          </p>
        ))}
        {reading.interpretation?.contains_instructions && (
          <p className="reading-flag">
            The message asks the system to do something. That request was not
            acted on.
          </p>
        )}
      </div>
      <div className="reading-part" data-kind="rule">
        <h4>
          Decided by rules <span>from delivery and payment records</span>
        </h4>
        <ul>
          {(reading.resolutions || []).map((r, i) => {
            const [label, tone] = OUTCOME[r.outcome] || [
              readableState(r.outcome),
              "neutral",
            ];
            return (
              <li key={i}>
                <span>Clip {String(r.clip).padStart(2, "0")}</span>
                <Chip tone={tone} quiet>
                  {label}
                </Chip>
              </li>
            );
          })}
        </ul>
        {reading.reply && <p className="reading-reply">{reading.reply}</p>}
      </div>
    </div>
  );
}

const rootFor = (id) => `/v1/batches/${id}`;
function navigate(path) {
  window.location.hash = path;
}
function useData(load, keys = []) {
  const [result, setResult] = useState({
    loading: true,
    data: null,
    error: null,
  });
  const [revision, reload] = useState(0);
  useEffect(() => {
    let active = true;
    setResult((v) => ({ ...v, loading: true, error: null }));
    Promise.resolve()
      .then(load)
      .then((data) => {
        if (active) setResult({ data, loading: false, error: null });
      })
      .catch((error) => {
        if (active) setResult({ data: null, loading: false, error });
      });
    return () => {
      active = false;
    };
  }, [...keys, revision]);
  return { ...result, reload: () => reload((n) => n + 1) };
}
const STATUS_TONE = { warning: "unknown", success: "confirmed", neutral: "neutral" };
function Status({ children, tone = "neutral" }) {
  return <Chip tone={STATUS_TONE[tone] || tone}>{children}</Chip>;
}
function ErrorBox({ error }) {
  if (error?.status === 401)
    try {
      sessionStorage.setItem("pvd-return", "/" + location.hash);
    } catch {}
  return error ? (
    <div className="flow-error" role="alert">
      <strong>We couldn’t complete this step</strong>
      <p>{error.message || error}</p>
      {error.status === 401 && <a href={`#/signin`}>Sign in to continue</a>}
    </div>
  ) : null;
}
function Loading({ resource, children }) {
  if (resource.loading)
    return (
      <p className="flow-loading" role="status">
        Loading the latest records…
      </p>
    );
  if (resource.error)
    return (
      <>
        <ErrorBox error={resource.error} />
        <button className="secondary" onClick={resource.reload}>
          Try loading again
        </button>
      </>
    );
  return children(resource.data);
}
function Page({ title, description, children, action, eyebrow }) {
  return (
    <main id="main" className="flow-page">
      <header className="page-head enter">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
          {description && <p className="lead">{description}</p>}
        </div>
        {action && <div className="actions">{action}</div>}
      </header>
      {children}
    </main>
  );
}
function Actions({ children }) {
  return <div className="flow-actions">{children}</div>;
}
function ButtonLink({ to, children, primary = false }) {
  return (
    <a
      className={primary ? "primary flow-button" : "secondary flow-button"}
      href={`#${to}`}
    >
      {children}
    </a>
  );
}
function Facts({ items }) {
  return (
    <dl className="flow-facts">
      {items.map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
const HELD_STATES = new Set(["AUTHORIZED", "RUNNING", "WAITING_FOR_AI", "INVESTIGATED", "READY_FOR_REVIEW", "SETTLEMENT_REQUESTED", "CLAIMED"]);
const STAGE_TONE = { attention: "ai", active: "pending", closed: "confirmed" };
function BatchQueue({ demo, connect, payments = false }) {
  const [cursor, setCursor] = useState("");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const data = useData(
    () => request(`/v1/batches?limit=20${cursor ? `&after=${cursor}` : ""}`),
    [demo, cursor],
  );
  const impact = useData(
    () => (payments ? null : request("/v1/operations/impact").catch(() => null)),
    [demo, payments],
  );
  const items = data.data?.items || [];
  const attention = items.filter((b) => deliveryStage(b.state).group === "attention");
  const open = items.filter((b) => deliveryStage(b.state).group !== "closed");
  // Money is never added across currencies: one total only when every open hold shares one.
  // Only states that follow a confirmed authorization count as held.
  const held = open.filter((b) => HELD_STATES.has(b.state));
  const heldCurrencies = [...new Set(held.map((b) => b.currency || "USD"))];
  const heldOpen = heldCurrencies.length === 1 ? held.reduce((n, b) => n + b.ceiling_minor, 0) : 0;
  const first = attention[0] || open[0];
  const [flash, setFlash] = useState(() => {
    try {
      const note = sessionStorage.getItem("assay-flash") || "";
      sessionStorage.removeItem("assay-flash");
      return note;
    } catch {
      return "";
    }
  });
  return (
    <Page
      eyebrow={payments ? "Payment records" : `Command center · ${open.length} open ${open.length === 1 ? "delivery" : "deliveries"}`}
      title={
        payments ? (
          <>Every hold, capture and refund, <em>on one record.</em></>
        ) : data.loading ? (
          <>Reading the <em>delivery records.</em></>
        ) : attention.length ? (
          <>{attention.length === 1 ? "One decision is" : `${attention.length} decisions are`} <em>waiting on you.</em></>
        ) : open.length ? (
          <>{open.length === 1 ? "One delivery is" : `${open.length} deliveries are`} <em>in progress.</em></>
        ) : (
          <>Every paid job <em>reconciles.</em></>
        )
      }
      description={
        payments
          ? "An authorization is a hold, a capture is a charge, and a refund returns part of a capture. They are never merged."
          : "Assay compares what each paid job promised, charged, generated, stored and delivered. Anything that disagrees lands here, ranked by what needs a human."
      }
      action={
        payments ? null : first ? (
          <>
            <ButtonLink to={demo ? "/settings" : "/new"}>
              <PlusIcon size={15} aria-hidden="true" />
              New delivery
            </ButtonLink>
            <a className="btn btn-proof btn-lg" href={`#/batches/${first.id}`}>
              Review {first.title || "the next delivery"}
              <ArrowSquareOutIcon size={15} aria-hidden="true" />
            </a>
          </>
        ) : (
          <ButtonLink to={demo ? "/settings" : "/new"} primary>
            <PlusIcon size={15} aria-hidden="true" />
            New delivery
          </ButtonLink>
        )
      }
    >
      {flash && (
        <p className="inline-banner" data-tone="pending" role="status">
          <span>{flash}</span> <button className="text-link" onClick={() => setFlash("")}>Dismiss</button>
        </p>
      )}
      {!payments && data.data && (
        <dl className="metrics">
          <div data-tone="broken">
            <dt className="eyebrow">Open</dt>
            <dd><span className="display">{open.length}</span> {open.length === 1 ? "delivery" : "deliveries"}</dd>
            <p className="num">not yet settled</p>
          </div>
          <div data-tone="inferred">
            <dt className="eyebrow">Decide</dt>
            <dd><span className="display">{attention.length}</span> need your review</dd>
            <p className="num">{attention.slice(0, 2).map((b) => b.title || `Untitled ${b.id.slice(0, 8)}`).join(" · ") || "nothing waiting"}</p>
          </div>
          <div data-tone="pending">
            <dt className="eyebrow">Money</dt>
            <dd><span className="display">{heldCurrencies.length > 1 ? "Mixed" : money(heldOpen, heldCurrencies[0])}</span> held</dd>
            <p className="num">{heldCurrencies.length > 1 ? `${heldCurrencies.join(", ")}: not added together` : held.length ? "authorized in PayPal, not captured" : "no authorization is open"}</p>
          </div>
          <div data-tone="verified">
            <dt className="eyebrow">Proof</dt>
            <dd><span className="display">{impact.data?.clips_recovered_without_rerender ?? 0}</span> recovered</dd>
            <p className="num">{impact.data ? `${money(impact.data.charged_minor)} captured · ${money(impact.data.never_taken_minor)} never taken` : "no settled deliveries yet"}</p>
          </div>
        </dl>
      )}
      <Loading resource={data}>
        {({ items, next }) => {
          const shown = filterDeliveries(items, query, group);
          const counts = {
            all: items.length,
            attention: items.filter((b) => deliveryStage(b.state).group === "attention").length,
            closed: items.filter((b) => deliveryStage(b.state).group === "closed").length,
          };
          return (
            <section className="sheet" aria-labelledby="queue-title">
              <div className="sheet-head">
                <h2 id="queue-title">{payments ? "Deliveries with a payment record" : "Deliveries by urgency"}</h2>
                <div className="seg" role="group" aria-label="Filter deliveries">
                  {[["all", "All"], ["attention", "Needs you"], ["closed", "Closed"]].map(([value, label]) => (
                    <button key={value} aria-pressed={group === value} onClick={() => setGroup(value)}>
                      {label} {counts[value]}
                    </button>
                  ))}
                </div>
                <label className="queue-search">
                  <MagnifyingGlassIcon size={15} aria-hidden="true" />
                  <span className="sr-only">Search deliveries on this page</span>
                  <input type="search" placeholder="Search name or reference" value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
              </div>
              {!shown.length ? (
                <div className="empty-state">
                  <h2 className="display">{items.length ? "No matching deliveries." : "Your first delivery starts here."}</h2>
                  <p>{items.length ? "Try another name, reference or filter." : "Set a fixed agreement, ask your buyer to authorize it through PayPal, then attach the original video jobs."}</p>
                  {items.length ? (
                    <button className="btn btn-outline" onClick={() => { setQuery(""); setGroup("all"); }}>Clear filters</button>
                  ) : (
                    <ButtonLink to={demo ? "/settings" : "/new"} primary>Create an agreement</ButtonLink>
                  )}
                </div>
              ) : (
                <div className="ledger-scroll">
                  <table className="queue">
                    <thead>
                      <tr><th scope="col">Delivery</th><th scope="col">Agreement</th><th scope="col">Proof line</th><th scope="col">Money</th><th scope="col">State</th><th scope="col"><span className="sr-only">Open</span></th></tr>
                    </thead>
                    <tbody>
                      {shown.map((b) => {
                        const stage = deliveryStage(b.state);
                        const target = `/${payments ? "payments" : "batches"}/${b.id}`;
                        return (
                          <tr key={b.id}>
                            <th scope="row">
                              <a href={`#${target}`}>{b.title || `Untitled delivery ${b.id.slice(0, 8)}`}</a>
                              <span className="num">{b.id.slice(0, 8)} · <time dateTime={b.created_at}>{new Date(b.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</time></span>
                            </th>
                            <td>{b.units.length} {b.units.length === 1 ? "clip" : "clips"} at {money(b.units[0]?.price_minor || 0, b.currency)}</td>
                            <td><ProofLine stations={coarseStations(b.state)} size="mini" /></td>
                            <td className="num">{money(b.ceiling_minor, b.currency)}<span>{stage.group === "closed" ? "ceiling" : HELD_STATES.has(b.state) ? "held, not a charge" : "ceiling, nothing held"}</span></td>
                            <td><Chip tone={STAGE_TONE[stage.group] || "pending"}>{stage.label}</Chip></td>
                            <td><a className="text-link" href={`#${target}`}>{payments ? "Payments" : stage.action}</a></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="queue-foot">
                <span role="status" aria-live="polite">{shown.length} of {items.length} on this page. Search and filters apply to this page.</span>
                <span>
                  {cursor && <button className="text-link" onClick={() => setCursor("")}>First page</button>}
                  {next && <button className="text-link" onClick={() => setCursor(next)}>Next page</button>}
                </span>
              </p>
            </section>
          );
        }}
      </Loading>
    </Page>
  );
}
function NewBatch({ session }) {
  const directory = useData(buyerDirectory, []);
  const [estimate, setEstimate] = useState({
    title: "Untitled delivery",
    units: 10,
    price: 500,
    ceiling: 5000,
    buyer: "No buyer selected",
  });
  function updateEstimate(e) {
    const f = new FormData(e.currentTarget);
    let price = null,
      ceiling = null;
    const units = Number(f.get("units"));
    try {
      price = usdMinor(f.get("price"));
      if (Number.isInteger(units) && units >= 1 && units <= 10)
        ceiling = units * price;
    } catch {}
    setEstimate({
      title: String(f.get("title") || "Untitled delivery"),
      units,
      price,
      ceiling,
      buyer:
        directory.data?.buyers.find((b) => b.id === f.get("buyer"))?.name ||
        "No buyer selected",
    });
  }
  const [createIntent] = useState(() => {
    const saved = sessionStorage.getItem("pvd-new-batch-intent");
    if (saved) return saved;
    const next = crypto.randomUUID();
    sessionStorage.setItem("pvd-new-batch-intent", next);
    return next;
  });
  const [error, setError] = useState(null),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      const price = usdMinor(f.get("price"));
      const b = await request("/v1/batches", {
        body: {
          buyer_id: f.get("buyer"),
          title: f.get("title"),
          unit_count: Number(f.get("units")),
          unit_price_minor: price,
          currency: "USD",
          prompt: f.get("prompt"),
        },
        intent: `new-batch:${createIntent}`,
      });
      sessionStorage.removeItem("pvd-new-batch-intent");
      navigate(`/batches/${b.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page
      eyebrow="Command center · New delivery"
      title={<>Agree the work, <em>then the ceiling.</em></>}
      description="Set the clips, the fixed price and the most the buyer can be charged. The buyer authorizes that ceiling with PayPal before any work is billed."
      action={<ButtonLink to="/batches">Back to deliveries</ButtonLink>}
    >
      <div className="agreement-editor">
        <form
          className="flow-form agreement-form"
          onSubmit={submit}
          onInput={updateEstimate}
        >
          <ErrorBox error={error} />
          <section className="editor-section">
            <div className="section-heading">
              <h2>Delivery details</h2>
              <p>Give the buyer a clear description of the work.</p>
            </div>
            <label>
              Delivery name
              <input
                name="title"
                aria-label="Delivery name"
                aria-describedby="delivery-name-help"
                required
                maxLength="100"
                placeholder="For example, Coastal collection"
              />
              <span className="field-help" id="delivery-name-help">
                Visible on the buyer's agreement and delivery page.
              </span>
            </label>
            <label>
              Production brief
              <textarea
                aria-label="Production brief"
                aria-describedby="production-brief-help"
                name="prompt"
                minLength="5"
                maxLength="2000"
                rows="4"
                required
                placeholder="Describe the clips the provider will be asked to make."
              />
              <span className="field-help" id="production-brief-help">
                For the provider job. Buyer billing uses the fixed technical
                terms below.
              </span>
            </label>
          </section>
          <section className="editor-section">
            <div className="section-heading">
              <h2>Buyer and pricing</h2>
              <p>
                The buyer reviews these fixed prices before authorizing the
                ceiling.
              </p>
            </div>
            <label>
              Buyer
              <select
                name="buyer"
                aria-label="Buyer"
                aria-describedby="delivery-buyer-help"
                required
                disabled={directory.loading}
              >
                <option value="">Choose a buyer</option>
                {directory.data?.buyers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <span className="field-help" id="delivery-buyer-help">
                Only the assigned buyer can consent and retrieve the files.
              </span>
            </label>
            <ErrorBox error={directory.error} />
            <div className="form-pair">
              <label>
                Number of clips
                <input
                  name="units"
                  type="number"
                  min="1"
                  max="10"
                  defaultValue="10"
                  required
                />
              </label>
              <label>
                Price per clip
                <input
                  name="price"
                  aria-label="Price per clip"
                  aria-describedby="delivery-price-help"
                  type="number"
                  min="0.01"
                  max="1000"
                  step="0.01"
                  defaultValue="5.00"
                  required
                />
                <span className="field-help" id="delivery-price-help">
                  US dollars (USD)
                </span>
              </label>
            </div>
          </section>
          <section className="editor-section">
            <div className="section-heading">
              <h2>Delivery terms</h2>
              <p>
                A technical delivery agreement; creative satisfaction is handled
                separately.
              </p>
            </div>
            <dl className="editor-terms">
              <div>
                <dt>Video format</dt>
                <dd>H.264, at least 720px high</dd>
              </div>
              <div>
                <dt>Length and size</dt>
                <dd>4-10 seconds, up to 25 MiB per clip</dd>
              </div>
              <div>
                <dt>Delivery window</dt>
                <dd>30 minutes from creation</dd>
              </div>
              <div>
                <dt>File retention</dt>
                <dd>7 days from creation</dd>
              </div>
            </dl>
            <p className="editor-terms-note">
              A technically valid file the buyer can retrieve is billable. Files
              are available before capture, and the merchant bears
              capture-failure risk.
            </p>
            <label className="check-label">
              <input type="checkbox" required />
              <span>
                I have reviewed the buyer, fixed prices and delivery terms.
                These details cannot be changed after creation.
              </span>
            </label>
          </section>
          <div className="mobile-editor-total">
            <span>Maximum <PayPalLogo size="xs" /> authorization</span>
            <strong>
              {estimate.ceiling !== null
                ? money(estimate.ceiling)
                : "Enter a valid amount"}
            </strong>
            <small>Ceiling only. This step does not charge the buyer.</small>
          </div>
          <div className="editor-footer">
            <ButtonLink to="/batches">Cancel</ButtonLink>
            <button
              className="primary"
              disabled={busy || directory.loading || !!directory.error}
            >
              {busy ? "Creating agreement…" : "Create agreement"}
            </button>
          </div>
        </form>
        <aside className="agreement-preview" aria-label="Agreement preview">
          <div className="agreement-preview-header">
            <FilmStripIcon size={20} aria-hidden="true" />
            <h2>Agreement preview</h2>
          </div>
          <h3>{estimate.title}</h3>
          <p className="preview-buyer">
            {estimate.buyer === "No buyer selected"
              ? estimate.buyer
              : `For ${estimate.buyer}`}
          </p>
          <dl className="preview-calculation">
            <div>
              <dt>
                {Number.isInteger(estimate.units) && estimate.units > 0
                  ? estimate.units
                  : "—"}{" "}
                {estimate.units === 1 ? "clip" : "clips"}
              </dt>
              <dd>
                {estimate.price !== null
                  ? `${money(estimate.price)} each`
                  : "Enter a valid price"}
              </dd>
            </div>
          </dl>
          <div className="preview-total">
            <span>Maximum authorization</span>
            <strong>
              {estimate.ceiling !== null ? money(estimate.ceiling) : "—"}
            </strong>
            <span>USD · PayPal authorization ceiling</span>
          </div>
          <p className="preview-explanation">
            This is a ceiling, not the final charge. The final capture includes
            only eligible delivery, under the fixed agreement.
          </p>
          <div className="agreement-next">
            <h3>What happens next</h3>
            <ol>
              <li>Buyer reviews the agreement and authorizes PayPal.</li>
              <li>
                You attach original jobs and recover delivery with AI evidence.
              </li>
              <li>You review and approve the exact eligible amount.</li>
            </ol>
          </div>
          <p className="preview-source-note">
            Existing provider jobs only. Creating this agreement does not buy
            another render.
          </p>
        </aside>
      </div>
    </Page>
  );
}
function Agreement({ id, demo, session }) {
  const resource = useData(
    () =>
      demo
        ? { batch: demoBatch, financial: { environment: "demo" } }
        : Promise.all([
            request(rootFor(id), { role: "buyer" }),
            request(rootFor(id) + "/financials", { role: "buyer" }),
            // Public client id for the PayPal button. Absent on older services: the
            // approval link below still works without it.
            request("/v1/paypal/config", { role: "buyer" }).catch(() => null),
          ]).then(([batch, financial, paypal]) => ({ batch, financial, paypal })),
    [id, demo],
  );
  const [error, setError] = useState(null),
    [busy, setBusy] = useState(false),
    [url, setUrl] = useState(null),
    [accepted, setAccepted] = useState(false),
    [sdkFailed, setSdkFailed] = useState(false);
  // Consent, then the one server-created order for this batch. The intent keys make a
  // repeat call return the same order rather than create another.
  async function prepareOrder() {
    await request(rootFor(id) + "/consent", {
      role: "buyer",
      body: { contract_hash: resource.data.batch.contract_hash },
      intent: `consent:${id}:${resource.data.batch.contract_hash}`,
    });
    const order = await request(rootFor(id) + "/paypal/order", {
      role: "buyer",
      body: {},
      intent: `paypal-order:${id}`,
    });
    const href = safeApprovalUrl(order.approval_url);
    if (!href)
      throw Error(
        "The approval link is unavailable. Refresh the payment record; do not create another order.",
      );
    sessionStorage.setItem("pvd-checkout", id);
    return { order, href };
  }
  async function authorize() {
    setBusy(true);
    setError(null);
    try {
      const { href } = await prepareOrder();
      setUrl(href);
      resource.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  // For the PayPal button: hand PayPal the id of the order our server created.
  async function orderIdForButton() {
    setError(null);
    try {
      const { order, href } = await prepareOrder();
      const orderId = order.provider_id || new URL(href).searchParams.get("token");
      if (!orderId) throw Error("The PayPal order could not be identified. No new order was created.");
      setUrl(href);
      return orderId;
    } catch (e) {
      setError(e);
      throw e;
    }
  }
  async function check() {
    setBusy(true);
    setError(null);
    try {
      const value = await request(rootFor(id) + "/paypal/authorize", {
        role: "buyer",
        body: {},
        intent: `authorize:${id}`,
      });
      if (value.state === "AUTHORIZED") navigate(`/buyer/${id}`);
      else {
        resource.reload();
        throw Error(
          "Authorization has not been confirmed. Your existing order is preserved.",
        );
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page
      eyebrow="Your delivery · Agreement"
      title={<>Agree the clips, <em>then authorize the hold.</em></>}
      description="Read what you will receive and the most you can be charged. PayPal holds that amount; you are charged only for clips you can open."
    >
      <Loading resource={resource}>
        {({ batch: b, financial: f, paypal }) => {
          const canOrder = ["AWAITING_BUYER_APPROVAL", "ACCEPTED", "AUTHORIZING", "AUTHORIZED"].includes(b.state);
          const useSdk = f.environment === "sandbox" && !sdkFailed && !!paypalSdkUrl(paypal, b.currency);
          const linkFlow = (
            <>
              <Actions>
                <button className={useSdk ? "secondary" : "primary"} disabled={busy || !accepted || !canOrder} onClick={authorize}>
                  {busy ? "Checking agreement…" : useSdk ? "Open PayPal in a new tab instead" : "Prepare PayPal authorization"}
                </button>
              </Actions>
              {f.environment !== "fixture" && (url || safeApprovalUrl(f.order?.approval_url)) && (
                <a className="paypal-button" href={url || safeApprovalUrl(f.order?.approval_url)} target="_blank" rel="noopener noreferrer">
                  <PayPalLogo size="md" /> Continue in Sandbox
                </a>
              )}
              <button className="secondary" onClick={check} disabled={busy || !b.consented_at}>
                {f.environment === "fixture" ? "Confirm the simulated authorization" : "I approved in PayPal. Check the authorization"}
              </button>
            </>
          );
          return (
          <div className="two-column">
            <section className="document-panel">
              <span className="tag-env" data-env={f.environment === "sandbox" ? "sandbox" : "fixture"}>
                {f.environment === "sandbox" ? "PayPal Sandbox" : f.environment === "fixture" ? "Test fixtures, not PayPal" : f.environment === "demo" ? "Illustrative walkthrough" : "Environment unverified"}
              </span>
              <h2 className="buyer-agreement-title">
                {b.title || "Video delivery agreement"}
              </h2>
              <p>
                From{" "}
                {session?.merchant_name ||
                  (f.environment === "fixture"
                    ? "Test merchant workspace"
                    : "your studio")}
              </p>
              <Facts
                items={[
                  ["Delivery reference", <Reference value={b.id} label="delivery reference" />],
                  [
                    "Deliverables",
                    `${b.units.length} clips at ${money(b.units[0]?.price_minor || 0, b.currency)} each`,
                  ],
                  ["Maximum authorization", money(b.ceiling_minor, b.currency)],
                  ["Delivery window ends", stamp(b.deadline)],
                  ["Files retained until", stamp(b.retention_until)],
                  [
                    "Technical requirements",
                    "H.264 · height ≥720px · 4–10 seconds · ≤25 MiB",
                  ],
                  [
                    "Agreement version",
                    b.contract_hash ? <Reference value={b.contract_hash} label="agreement version" /> : "Illustrative agreement",
                  ],
                ]}
              />
              <p>
                Only technically valid, purchaser-retrievable files are
                billable. Eligible files are available before the final charge.
                Creative satisfaction is not guaranteed by technical
                verification.
              </p>
              <p>
                You are charged {money(b.units[0]?.price_minor || 0, b.currency)} for
                each clip that qualifies, up to {money(b.ceiling_minor, b.currency)}. Any
                part of the authorization that is not charged is released; it
                is not a refund. The merchant bears the risk if the final
                capture fails.
              </p>
            </section>
            <section className="document-panel">
              <h2>Authorize with <PayPalLogo size="lg" /></h2>
              <p>
                This is a temporary authorization ceiling, not confirmation of a
                completed charge.
              </p>
              <ErrorBox error={error} />
              {demo ? (
                <div className="flow-notice">
                  Illustrative agreement. Connect services to authorize a real
                  Sandbox order.
                </div>
              ) : (
                <>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={accepted}
                      onChange={(e) => setAccepted(e.target.checked)}
                    />
                    I agree to the deliverables, technical billability and
                    retention date.
                  </label>
                  {useSdk ? (
                    <>
                      <PayPalButton
                        config={paypal}
                        currency={b.currency}
                        disabled={busy || !accepted || !canOrder}
                        createOrder={orderIdForButton}
                        onApprove={check}
                        onCancel={() => setError(Error("PayPal was closed before approval. Nothing was authorized; the same order is kept."))}
                        onError={(e) => setError((prev) => prev || e)}
                        onUnavailable={() => setSdkFailed(true)}
                      />
                      <p className="plain-note">
                        PayPal Sandbox. Approving places a hold of up to {money(b.ceiling_minor, b.currency)}. It is confirmed here only after our server checks it with PayPal.
                      </p>
                      <details className="paypal-fallback">
                        <summary>PayPal window did not open, or was closed?</summary>
                        {linkFlow}
                      </details>
                    </>
                  ) : (
                    linkFlow
                  )}
                  {f.environment === "fixture" && (
                    <p className="flow-notice">
                      Test fixtures: the next check uses a simulated buyer
                      approval. No PayPal website or real payment is involved.
                    </p>
                  )}
                  <p className="plain-note">
                    If you close or cancel PayPal, no completed charge is
                    inferred. Return here to resume the same order.
                  </p>
                </>
              )}
              <Actions>
                <ButtonLink to={`/buyer/${id}`}>
                  View delivery status
                </ButtonLink>
              </Actions>
            </section>
          </div>
          );
        }}
      </Loading>
    </Page>
  );
}
function Tasks({ id }) {
  const data = useData(
    () =>
      Promise.all([
        request(rootFor(id)),
        request(rootFor(id) + "/review"),
      ]).then(([batch, review]) => ({ batch, review })),
    [id],
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(null),
    [notice, setNotice] = useState("");
  async function attach(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await request(rootFor(id) + "/attempts", {
        body: { unit_id: f.get("unit"), provider_task_id: f.get("task") },
        intent: `attach:${id}:${f.get("unit")}`,
      });
      setNotice("Original task attached. No repeat inference was requested.");
      data.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function lookup(attempt) {
    setBusy(true);
    setError(null);
    try {
      await request(rootFor(id) + `/attempts/${attempt.id}/lookup`, {
        body: {},
        intent: `lookup:${attempt.id}:${crypto.randomUUID()}`,
      });
      setNotice(
        "Original provider task checked; no new inference was submitted.",
      );
      data.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function preserve(attempt) {
    setBusy(true);
    setError(null);
    try {
      await request(rootFor(id) + "/preserve", {
        body: { attempt_id: attempt.id },
        intent: `preserve:${attempt.id}`,
      });
      setNotice(
        "Preservation checked. Inspect the result before restoring buyer access.",
      );
      data.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page
      eyebrow="Delivery · Provider tasks"
      title={<>Every clip, <em>and the job that made it.</em></>}
      description="Match each clip to the provider task that already ran, then archive its original file. Nothing here asks the provider for a new render."
      action={<ButtonLink to={`/batches/${id}`}>Back to the investigation</ButtonLink>}
    >
      <ErrorBox error={error} />
      {notice && (
        <p role="status" className="flow-notice">
          {notice}
        </p>
      )}
      <Loading resource={data}>
        {({ batch: b, review: r }) => (
          <>
            <section className="sheet task-sheet" aria-labelledby="tasks-title">
            <div className="sheet-head">
              <h2 id="tasks-title">{b.title || "Untitled delivery"} · {b.units.length} {b.units.length === 1 ? "clip" : "clips"}</h2>
              <span className="source">provider and archive records</span>
            </div>
            <div className="unit-list">
              {b.units.map((u, i) => {
                const attempts = r.attempts.filter((a) => a.unit_id === u.id),
                  files = r.artifacts.filter((a) => a.unit_id === u.id);
                return (
                  <article className="unit-row" key={u.id}>
                    <h2>Clip {String(i + 1).padStart(2, "0")}</h2>
                    <p>
                      {money(u.price_minor, b.currency)} billable if the buyer can open it ·
                      Provider cost not reported
                    </p>
                    {!attempts.length && (
                      <Status>No provider task on record</Status>
                    )}
                    {attempts.map((a) => (
                      <div key={a.id}>
                        <Status tone={a.state === "SUCCEEDED" ? "confirmed" : a.state === "FAILED" ? "failed" : "pending"}>{readableState(a.state)}</Status>
                        <p>
                          Provider task{" "}
                          {a.provider_task_id ? <Reference value={a.provider_task_id} label="provider task" /> : "unknown. Do not resubmit."}
                        </p>
                        <button
                          className="secondary"
                          disabled={busy || !a.provider_task_id}
                          onClick={() => lookup(a)}
                        >
                          Check original task
                        </button>
                        {a.state === "SUCCEEDED" && !files.length && (
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() => preserve(a)}
                          >
                            Preserve original file
                          </button>
                        )}
                      </div>
                    ))}
                    {files.map((f) => (
                      <p key={f.id}>
                        Archived copy: {readableState(f.state).toLowerCase()} ·{" "}
                        {f.published ? "published to the buyer" : "not published"} ·
                        kept until {stamp(f.retention_until)}
                      </p>
                    ))}
                  </article>
                );
              })}
            </div>
            </section>
            <form className="flow-form" onSubmit={attach}>
              <h2>Attach an existing task</h2>
              <label>
                Clip
                <select name="unit" required>
                  {b.units
                    .filter((u) => !r.attempts.some((a) => a.unit_id === u.id))
                    .map((u) => (
                      <option value={u.id} key={u.id}>
                        Clip {String(b.units.indexOf(u) + 1).padStart(2, "0")}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Original provider task ID
                <input
                  name="task"
                  required
                  maxLength="100"
                  autoComplete="off"
                />
              </label>
              <p className="plain-note">
                A confirmed authorization and an active delivery window are
                required. An uncertain task must be looked up under its original
                identity.
              </p>
              <button
                className="primary"
                disabled={
                  busy ||
                  !b.units.some(
                    (u) => !r.attempts.some((a) => a.unit_id === u.id),
                  )
                }
              >
                Attach original task
              </button>
            </form>
          </>
        )}
      </Loading>
    </Page>
  );
}
function Payments({ id, role }) {
  const resource = useData(
    () =>
      Promise.all([
        request(rootFor(id), { role }),
        request(rootFor(id) + "/financials", { role }),
      ]).then(([batch, financial]) => ({ batch, financial })),
    [id, role],
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(null),
    [preview, setPreview] = useState(null),
    [clock, setClock] = useState(Date.now());
  useEffect(() => {
    if (!preview) return;
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, [preview]);
  async function reconcile(op) {
    setBusy(true);
    setError(null);
    try {
      await request(`/v1/operations/${op.id}/reconcile`, {
        body: {},
        intent: `reconcile:${op.id}:${crypto.randomUUID()}`,
      });
      resource.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function reviewRefund(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const f = new FormData(e.currentTarget);
      if (!f.getAll("units").length)
        throw Error(
          "Choose at least one captured clip before preparing a refund.",
        );
      const assessment = await investigateBatch(id);
      const value = await request(rootFor(id) + "/refund-preview", {
        body: {
          unit_ids: f.getAll("units"),
          reason: f.get("reason"),
          assessment_id: assessment.id,
        },
        intent: `refund-preview:${crypto.randomUUID()}`,
      });
      setPreview(value);
      setClock(Date.now());
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function approveRefund() {
    setBusy(true);
    setError(null);
    try {
      await request(rootFor(id) + "/refunds", {
        body: {
          unit_ids: preview.unit_ids,
          reason: preview.reason,
          assessment_id: preview.assessment_id,
          proposal_id: preview.id,
          approval_digest: preview.approval_digest,
          emergency: false,
        },
        intent: `refund-approve:${preview.id}`,
      });
      setPreview(null);
      resource.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await request(rootFor(id) + "/cancel", {
        role,
        body: {},
        intent: `cancel:${id}`,
      });
      resource.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  function exportReceipt(f) {
    const safe = {
      batch_id: id,
      environment: f.environment,
      authorization: f.authorization,
      operations: f.operations,
      observed_at: f.observed_at,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(safe, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `payment-record-${id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Page
      eyebrow="Records · Payments"
      title={<>The hold, the charge and any refund, <em>kept apart.</em></>}
      description="An authorization is a hold. A capture is the one charge. A refund returns part of a capture. Each is read back from the payment record and shown on its own line."
      action={
        <ButtonLink to={role === "buyer" ? `/buyer/${id}` : `/batches/${id}`}>
          Back to delivery
        </ButtonLink>
      }
    >
      <ErrorBox error={error} />
      <Loading resource={resource}>
        {({ batch: b, financial: f }) => {
          const totals = paymentSummary(f.operations);
          const refundable = new Set(
            (f.refundable_units || []).map((u) => u.unit_id),
          );
          return (
            <>
              <div className="flow-summary payment-summary">
                <div className="payment-summary-head">
                  <Chip tone={f.environment === "sandbox" ? "authorized" : "neutral"}>
                    {f.environment === "sandbox"
                      ? "PayPal Sandbox"
                      : f.environment === "fixture"
                        ? "Test fixtures, not PayPal"
                        : "Illustrative walkthrough"}
                  </Chip>
                  <span>Last checked {stamp(f.observed_at)}</span>
                </div>
                <dl className="payment-figures">
                  <div data-tone="authorized">
                    <dt>{f.authorization?.state === "AUTHORIZED" ? "Authorized hold" : "Agreed ceiling"}</dt>
                    <dd>{money(b.ceiling_minor, b.currency)}</dd>
                    <Chip tone={f.authorization?.state === "AUTHORIZED" ? "authorized" : "neutral"} quiet>
                      {f.authorization
                        ? `${readableState(f.authorization.state)}, not a charge`
                        : "No hold confirmed yet"}
                    </Chip>
                  </div>
                  <div data-tone="confirmed">
                    <dt>Captured</dt>
                    <dd>{money(totals.captured, b.currency)}</dd>
                    <Chip tone={totals.captured ? "confirmed" : "neutral"} quiet>
                      {totals.captured ? "Confirmed by read-back" : "Nothing captured"}
                    </Chip>
                  </div>
                  <div data-tone="refunded">
                    <dt>Refunded</dt>
                    <dd>{money(totals.refunded, b.currency)}</dd>
                    <Chip tone={totals.pendingRefund ? "pending" : totals.refunded ? "refunded" : "neutral"} quiet>
                      {totals.pendingRefund
                        ? `${money(totals.pendingRefund, b.currency)} more pending`
                        : totals.refunded
                          ? "Against the original capture"
                          : "No refunds"}
                    </Chip>
                  </div>
                  <div data-tone="neutral">
                    <dt>Net collected</dt>
                    <dd>{money(totals.net, b.currency)}</dd>
                    <Chip tone="neutral" quiet>
                      {totals.captured
                        ? `${money(b.ceiling_minor - totals.captured, b.currency)} never taken`
                        : "Confirmed amounts only"}
                    </Chip>
                  </div>
                </dl>
                <p>
                  An authorization is a hold. The part of it that is never
                  captured is released, not refunded. File access does not wait
                  for capture.
                </p>
              </div>
              <Actions>
                <button className="secondary" onClick={resource.reload}>
                  Refresh payment record
                </button>
                <button className="secondary" onClick={() => exportReceipt(f)}>
                  Download payment record
                </button>
              </Actions>
              <section className="payment-timeline">
                <h2>Transactions</h2>
                {!f.operations.length && (
                  <p>No capture, void or refund operation is recorded yet.</p>
                )}
                {f.operations.map((op) => (
                  <article className="transaction" key={op.id}>
                    <div>
                      <h3>
                        {op.kind === "VOID"
                          ? "Authorization released"
                          : `${readableState(op.kind)} · ${money(op.amount_minor, b.currency)}`}{" "}
                        <Chip tone={opTone(op)}>{readableState(op.state)}</Chip>
                      </h3>
                      <p>
                        Created {stamp(op.created_at)} · last update{" "}
                        {stamp(op.updated_at)}
                      </p>
                      <p className="transaction-refs">
                        {f.environment === "sandbox" ? "PayPal reference" : "Payment reference"}{" "}
                        <Reference value={op.provider_id || op.id} />
                        {op.capture_id && (
                          <>
                            {" "}
                            Original capture{" "}
                            <Reference value={op.capture_id} />
                          </>
                        )}
                      </p>
                      {[
                        "UNKNOWN",
                        "DISPATCHING",
                        "PENDING",
                        "RESERVED",
                        "NEEDS_REVIEW",
                      ].includes(op.state) && (
                        <p>
                          This result is not confirmed cash. Keep the original
                          operation; do not submit a replacement payment.
                        </p>
                      )}
                    </div>
                    {role === "operator" && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => reconcile(op)}
                      >
                        Check original operation
                      </button>
                    )}
                  </article>
                ))}
              </section>
              {role === "operator" && totals.captured > 0 && (
                <section className="document-panel">
                  <h2>Review a refund</h2>
                  <p>
                    Choose captured clips and a reason. The server calculates
                    the refund against the original capture and checks existing
                    remedies.
                  </p>
                  {!refundable.size && (
                    <p className="plain-note">
                      No captured clip is available for another refund. Refresh
                      the payment record if a refund is still pending.
                    </p>
                  )}
                  <form onSubmit={reviewRefund} className="flow-form" hidden={!refundable.size}>
                    <fieldset>
                      <legend>Affected clips</legend>
                      {b.units
                        .filter((u) => refundable.has(u.id))
                        .map((u) => (
                          <label key={u.id} className="check-label">
                            <input type="checkbox" name="units" value={u.id} />
                            Clip {String(b.units.indexOf(u) + 1).padStart(2, "0")} ·{" "}
                            {money(u.price_minor, b.currency)}
                          </label>
                        ))}
                    </fieldset>
                    <label>
                      Reason
                      <textarea
                        name="reason"
                        required
                        minLength="10"
                        maxLength="500"
                        rows="3"
                      />
                    </label>
                    <button
                      className="secondary"
                      disabled={busy || !refundable.size}
                    >
                      Prepare exact refund review
                    </button>
                  </form>
                  {preview && (
                    <div className="refund-preview">
                      <h3>
                        Refund {money(preview.amount_minor, b.currency)} to the original
                        capture
                      </h3>
                      <p>
                        Original capture <Reference value={preview.capture_id} label="PayPal capture" />
                      </p>
                      <p>
                        {preview.unit_ids.length} {preview.unit_ids.length === 1 ? "clip" : "clips"} · {preview.reason}
                      </p>
                      <p>
                        {Date.parse(preview.expires_at) <= clock
                          ? "This review expired. Prepare a new review."
                          : `Review expires at ${stamp(preview.expires_at)}.`}
                      </p>
                      <Actions>
                        <button
                          className="secondary"
                          onClick={() => setPreview(null)}
                        >
                          Discard review
                        </button>
                        <button
                          className="primary"
                          disabled={
                            busy || Date.parse(preview.expires_at) <= clock
                          }
                          onClick={approveRefund}
                        >
                          Approve {money(preview.amount_minor, b.currency)} refund
                        </button>
                      </Actions>
                    </div>
                  )}
                </section>
              )}
              {b.state === "CANCEL_REQUESTED" && (
                <p className="flow-notice" role="status">
                  Cancellation requested. This delivery is closed once the
                  service confirms that no payment is outstanding.
                </p>
              )}
              {!["CLOSED", "CLAIMED", "SETTLEMENT_REQUESTED", "CANCEL_REQUESTED"].includes(
                b.state,
              ) && (
                <section className="document-panel">
                  <h2>Cancel this delivery</h2>
                  <p>
                    Asks to cancel the agreement and release the PayPal hold. If
                    a payment request is already on its way, its outcome is
                    checked with PayPal first.
                  </p>
                  <details>
                    <summary>Review cancellation</summary>
                    <p>
                      This ends work on the delivery. Existing files and the
                      payment history are kept.
                    </p>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={cancel}
                    >
                      Confirm cancellation request
                    </button>
                  </details>
                </section>
              )}
            </>
          );
        }}
      </Loading>
    </Page>
  );
}
function Support({ id, role, demo }) {
  const data = useData(
    () => (demo ? { items: [] } : request(rootFor(id) + "/support", { role })),
    [id, role, demo],
  );
  const [error, setError] = useState(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    try {
      const c = await request(rootFor(id) + "/support", {
        role,
        body: { category: f.get("category"), message: f.get("message") },
      });
      setNotice(
        `Issue recorded. Reference ${c.id}. It is awaiting merchant review.`,
      );
      e.target.reset();
      data.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function resolve(e, c) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await request(rootFor(id) + `/support/${c.id}/resolve`, {
        body: { resolution: new FormData(e.currentTarget).get("resolution") },
      });
      data.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page
      eyebrow={role === "buyer" ? "Your delivery · Tell the studio" : "Records · Buyer messages"}
      title={role === "buyer" ? <>Something wrong? <em>Tell the studio.</em></> : <>What the buyer said, <em>and what the records say.</em></>}
      description={role === "buyer" ? "Write what happened in your own words. Your message is checked against the delivery and payment records for this order." : "Each message is read by AI for which clips it is about. The answer comes from the delivery and payment records, never from the AI."}
      action={<ButtonLink to={role === "buyer" ? `/buyer/${id}` : `/batches/${id}`}>{role === "buyer" ? "Back to your delivery" : "Back to the investigation"}</ButtonLink>}
    >
      <div className="two-column">
        <section className="document-panel">
          <h2>{role === "buyer" ? "Your message" : "Record a message"}</h2>
          <p>
            Delivery <Reference value={id} label="delivery reference" />
          </p>
          <p>
            For creative concerns, explain what did not match your brief.
            Reporting a concern does not silently change technical billability
            or guarantee a refund.
          </p>
          <ErrorBox error={error} />
          {notice && (
            <p className="flow-notice" role="status">
              {notice}
            </p>
          )}
          {demo ? (
            <p>
              The walkthrough has no message inbox. Connect services and open a
              delivery to record a message.
            </p>
          ) : (
            <form className="flow-form" onSubmit={submit}>
              <label>
                Issue type
                <select name="category">
                  <option value="access">Cannot play or download</option>
                  <option value="payment">Payment or authorization</option>
                  <option value="creative">Creative quality</option>
                  <option value="other">Something else</option>
                </select>
              </label>
              <label>
                What happened?
                <textarea
                  name="message"
                  required
                  minLength="10"
                  maxLength="2000"
                  rows="5"
                  placeholder="Describe the issue. Do not include passwords, API keys or private links."
                />
              </label>
              <button className="primary" disabled={busy}>
                Record issue for merchant review
              </button>
              <p className="plain-note">
                Recorded inside this application. No email has been sent and no
                response time is promised. Messages are kept as long as the
                delivery's files.
              </p>
            </form>
          )}
        </section>
        <section className="document-panel">
          <h2>Messages and answers</h2>
          <Loading resource={data}>
            {({ items }) => (
              <>
                {!items.length && <p>No messages recorded for this delivery.</p>}
                {items.map((c) => (
                  <article className="support-item" key={c.id}>
                    <h3>
                      {readableState(c.category)}{" "}
                      <Status>{readableState(c.state)}</Status>
                    </h3>
                    <blockquote>{c.message}</blockquote>
                    <small>
                      Reference {c.id} · {stamp(c.created_at)}
                    </small>
                    <Reading reading={c.reading} />
                    {c.resolution && <p>Merchant response: {c.resolution}</p>}
                    {role === "operator" && c.state !== "RESOLVED" && (
                      <form
                        className="flow-form"
                        onSubmit={(e) => resolve(e, c)}
                      >
                        <label>
                          Resolution
                          <textarea
                            name="resolution"
                            required
                            minLength="10"
                            maxLength="1000"
                            rows="2"
                          />
                        </label>
                        <button className="secondary" disabled={busy}>
                          Record resolution
                        </button>
                      </form>
                    )}
                  </article>
                ))}
              </>
            )}
          </Loading>
        </section>
      </div>
    </Page>
  );
}
function SupportInbox({ demo }) {
  const r = useData(
    () => (demo ? { items: [] } : request("/v1/support")),
    [demo],
  );
  return (
    <Page
      eyebrow="Records · Buyer messages"
      title={<>What buyers told you, <em>waiting for an answer.</em></>}
      description="Open messages across your deliveries. They are recorded here only; no email is sent."
    >
      <Loading resource={r}>
        {({ items }) => (
          <div className="document-panel">
            {!items.length ? (
              <p>
                {demo
                  ? "The walkthrough has no inbox. Connect services and open a delivery to record a message."
                  : "No open messages. Buyers can write to you from their delivery page."}
              </p>
            ) : (
              items.map((c) => (
                <article className="support-item" key={c.id}>
                  <h2>{readableState(c.category)}</h2>
                  <p>{c.message}</p>
                  <p>
                    Received {stamp(c.created_at)} · delivery{" "}
                    <Reference value={c.batch_id} label="delivery reference" />
                  </p>
                  <ButtonLink to={`/support/${c.batch_id}`}>
                    Read and answer
                  </ButtonLink>
                </article>
              ))
            )}
          </div>
        )}
      </Loading>
    </Page>
  );
}
function Activity({ id, role }) {
  const r = useData(
    () => request(rootFor(id) + "/activity", { role }),
    [id, role],
  );
  return (
    <Page
      eyebrow="Delivery · Activity"
      title={<>Every recorded change, <em>in order.</em></>}
      description="Changes to this agreement as the service recorded them."
      action={
        <ButtonLink to={role === "buyer" ? `/buyer/${id}` : `/batches/${id}`}>
          Back to delivery
        </ButtonLink>
      }
    >
      <Loading resource={r}>
        {({ events }) => (
          <div className="document-panel">
            {events.length ? (
              events.map((e) => (
                <article className="activity-event" key={e.sequence}>
                  <strong>{readableState(e.action)}</strong>
                  <time>{stamp(e.recorded_at)}</time>
                </article>
              ))
            ) : (
              <p>No recorded changes.</p>
            )}
            <p className="plain-note">
              This journal covers the agreement. Provider tasks and payments
              have their own records.
            </p>
          </div>
        )}
      </Loading>
    </Page>
  );
}
function Connections({ demo, connect, session }) {
  const r = useData(() => (demo ? null : request("/v1/readiness")), [demo]);
  const [tab, setTab] = useState("workspace");
  const [exitError, setExitError] = useState(null);
  const test = demo || r.data?.environment === "fixture";
  const config = {
    payments: {
      title: "PayPal",
      description:
        "Buyer authorizations, exact captures and refunds to the original payment.",
      icon: CreditCardIcon,
    },
    provider: {
      title: "Video provider",
      description: "Look up existing jobs and recover their original output.",
      icon: FilmStripIcon,
    },
    investigation: {
      title: "AI investigation",
      description:
        "Investigate delivery records and produce source-linked findings.",
      icon: SparkleIcon,
    },
    delivery: {
      title: "Private file delivery",
      description:
        "Preserve validated files and make them retrievable by the assigned buyer.",
      icon: ShieldCheckIcon,
    },
  };
  async function exit() {
    try {
      await signOut();
      sessionStorage.removeItem("pvd-mode");
      navigate("/signin");
      location.reload();
    } catch (e) {
      setExitError(e);
    }
  }
  return (
    <Page
      eyebrow="Records · Workspace"
      title={<>Your workspace, <em>and what it is connected to.</em></>}
      description="The merchant, the terms every agreement starts from, and the services that hold the records."
    >
      <div
        className="settings-tabs"
        role="tablist"
        aria-label="Workspace settings"
      >
        {[
          ["workspace", "Workspace"],
          ["connections", "Connections"],
        ].map(([value, label]) => (
          <button
            id={`settings-tab-${value}`}
            role="tab"
            key={value}
            aria-selected={tab === value}
            aria-controls={`settings-panel-${value}`}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)}
            onKeyDown={(e) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const next =
                  e.key === "Home"
                    ? "workspace"
                    : e.key === "End"
                      ? "connections"
                      : tab === "workspace"
                        ? "connections"
                        : "workspace";
                setTab(next);
                document.getElementById(`settings-tab-${next}`)?.focus();
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <ErrorBox error={exitError} />
      <div
        role="tabpanel"
        id={`settings-panel-${tab}`}
        aria-labelledby={`settings-tab-${tab}`}
        tabIndex={0}
      >
        {tab === "workspace" ? (
          <div className="settings-layout">
            <div className="settings-main">
              <section className="settings-section">
                <div className="section-heading">
                  <h2>Workspace</h2>
                  <p>
                    The merchant and currency used for your delivery agreements.
                  </p>
                </div>
                <dl className="settings-facts">
                  <div>
                    <dt>Workspace name</dt>
                    <dd>
                      {session?.merchant_name ||
                        (test
                          ? "Test merchant workspace"
                          : "Merchant workspace")}
                    </dd>
                  </div>
                  <div>
                    <dt>Access</dt>
                    <dd>
                      {session
                        ? session.role === "operator"
                          ? "Merchant operator"
                          : "Assigned buyer"
                        : "Local operator preview"}
                    </dd>
                  </div>
                  <div>
                    <dt>Currency</dt>
                    <dd>
                      US dollar <span className="secondary-detail">USD</span>
                    </dd>
                  </div>
                </dl>
              </section>
              <section className="settings-section">
                <div className="section-heading">
                  <h2>Delivery defaults</h2>
                  <p>These terms are fixed when each agreement is created.</p>
                </div>
                <dl className="settings-facts">
                  <div>
                    <dt>Billing basis</dt>
                    <dd>Technically valid and retrievable files</dd>
                  </div>
                  <div>
                    <dt>Buyer access</dt>
                    <dd>Available before the final capture</dd>
                  </div>
                  <div>
                    <dt>Delivery window</dt>
                    <dd>30 minutes from agreement creation</dd>
                  </div>
                  <div>
                    <dt>File retention</dt>
                    <dd>7 days from agreement creation</dd>
                  </div>
                </dl>
                <a className="text-link" href="#/privacy">
                  Read privacy and retention details
                  <ArrowSquareOutIcon size={16} aria-hidden="true" />
                </a>
              </section>
              <section className="settings-section session-section">
                <div className="section-heading">
                  <h2>Account access</h2>
                  <p>
                    {session
                      ? "Your access is tied to your verified account."
                      : "You are reviewing the product with development test identities."}
                  </p>
                </div>
                <details className="technical-disclosure">
                  <summary>Session details</summary>
                  <Facts
                    items={[
                      [
                        "Session",
                        session
                          ? "Authenticated"
                          : demo
                            ? "Illustrative preview"
                            : "Local development",
                      ],
                      ["Role", session?.role || "Operator preview"],
                      [
                        "Account reference",
                        session?.subject || "Development fixture identity",
                      ],
                    ]}
                  />
                </details>
                {demo ? (
                  <button className="secondary" onClick={connect}>
                    Connect services
                  </button>
                ) : (
                  <button className="secondary" onClick={exit}>
                    {session ? "Sign out" : "Exit preview"}
                  </button>
                )}
              </section>
            </div>
            <aside className="settings-context">
              <ShieldCheckIcon size={24} aria-hidden="true" />
              <h2>
                {r.loading
                  ? "Checking workspace"
                  : r.error
                    ? "Workspace status unavailable"
                    : test
                      ? "Test workspace"
                      : "Sandbox workspace"}
              </h2>
              <p>
                {r.loading
                  ? "Checking the configured environment and service status."
                  : r.error
                    ? "The configured environment could not be verified. Review connections before starting another authorization."
                    : test
                      ? "Payment events and provider jobs may be simulated here. No live-money payment is being represented."
                      : "PayPal transactions use the Sandbox environment. Live payments are not enabled."}
              </p>
              <button
                className="text-link"
                onClick={() => {
                  setTab("connections");
                  document.getElementById("settings-tab-connections")?.focus();
                }}
              >
                Review connections
                <ArrowSquareOutIcon size={16} aria-hidden="true" />
              </button>
            </aside>
          </div>
        ) : (
          <div className="settings-connections">
            <div className="connections-heading">
              <div>
                <h2>Connected services</h2>
                <p>Each service has a specific role in delivery and payment.</p>
              </div>
              <button
                className="secondary"
                onClick={r.reload}
                disabled={r.loading || demo}
              >
                <ArrowClockwiseIcon size={16} aria-hidden="true" />
                Refresh status
              </button>
            </div>
            <Loading resource={r}>
              {(d) =>
                !d ? (
                  <div className="delivery-empty">
                    <PlugsConnectedIcon size={28} aria-hidden="true" />
                    <h2>This is an illustrative preview</h2>
                    <p>
                      Connect the backend to inspect configured services. This
                      preview does not imply a connected PayPal account.
                    </p>
                    <button className="primary" onClick={connect}>
                      Connect services
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="connection-environment-note">
                      {d.environment === "fixture"
                        ? "Test workspace: payment and media records may be simulated. Connection checks do not prove a completed payment, provider job or AI run."
                        : "Sandbox configuration check. Availability does not prove a completed payment or provider job."}
                    </p>
                    <div className="service-register">
                      {d.services.map((service) => {
                        const item = config[service.service] || {
                          title: readableState(service.service),
                          description: "Service configuration",
                          icon: PlugsConnectedIcon,
                        };
                        const Icon = item.icon;
                        const good =
                          service.available && !service.payments_paused;
                        return (
                          <article
                            className="service-entry"
                            key={service.service}
                          >
                            <div className={`service-mark ${service.service}`}>
                              <Icon size={23} aria-hidden="true" />
                            </div>
                            <div className="service-description">
                              <h3>{item.title}</h3>
                              <p>{item.description}</p>
                              <span className="connection-result">
                                {service.payments_paused
                                  ? "Payment dispatch is paused"
                                  : good
                                    ? d.environment === "fixture"
                                      ? "Available in this test workspace"
                                      : "Configured and reachable"
                                    : "Service unavailable; review configuration"}
                              </span>
                              {service.merchant && (
                                <details className="technical-disclosure">
                                  <summary>Merchant reference</summary>
                                  <code>{service.merchant}</code>
                                </details>
                              )}
                            </div>
                            <div className="service-action">
                              <Status
                                tone={
                                  !good
                                    ? "warning"
                                    : d.environment === "fixture"
                                      ? "neutral"
                                      : "success"
                                }
                              >
                                {!good
                                  ? "Needs attention"
                                  : d.environment === "fixture"
                                    ? "Available"
                                    : "Configured"}
                              </Status>
                              {!good && (
                                <a className="text-link" href="#/operations">
                                  View diagnostics
                                </a>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                    <div className="connections-footnote">
                      <span>Last checked {stamp(d.observed_at)}</span>
                      <a className="text-link" href="#/operations">
                        Advanced diagnostics
                        <ArrowSquareOutIcon size={15} aria-hidden="true" />
                      </a>
                    </div>
                  </>
                )
              }
            </Loading>
          </div>
        )}
      </div>
    </Page>
  );
}
const SERVICE_NAMES = { commerce: "Agreements", provider: "Video provider", delivery: "File delivery", investigation: "AI investigation", payments: "PayPal payments" };
function Operations() {
  const r = useData(() => request("/v1/operations/overview"), []),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  async function pause(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const value = await request("/v1/controls/payments", {
        body: { paused: f.get("paused") === "true", reason: f.get("reason") },
        intent: `dispatch-control:${crypto.randomUUID()}`,
      });
      setNotice(
        value.paused
          ? "Payment dispatch paused. Read-only history and reconciliation remain available."
          : "Payment dispatch resumed.",
      );
      r.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page
      eyebrow="Workspace · Operations"
      title={<>What is queued, <em>and whether payments may go out.</em></>}
      description="Queue health for each service, and one switch that pauses new payment requests. Pausing never changes a recorded payment."
    >
      <ErrorBox error={error} />
      {notice && (
        <p role="status" className="flow-notice">
          {notice}
        </p>
      )}
      <Loading resource={r}>
        {(d) => (
          <section className="document-panel">
            <h2>Service queues</h2>
            <p>Checked {stamp(d.observed_at)}</p>
            {d.services.map((service) => (
              <article className="connection-row" key={service.service}>
                <div>
                  <h3>{SERVICE_NAMES[service.service] || readableState(service.service)}</h3>
                  {service.reachable === false ? (
                    <p>
                      Unavailable. Preserve unresolved operations and
                      investigate service health.
                    </p>
                  ) : (
                    <>
                      <p>
                        {service.payments_paused
                          ? "Payment dispatch paused"
                          : "Service reachable"}
                      </p>
                      {(service.queues || []).map((q) => (
                        <p key={q.state}>
                          {readableState(q.state)}: {q.count} {q.count === 1 ? "entry" : "entries"} · oldest{" "}
                          {stamp(q.oldest_created_at)}
                        </p>
                      ))}
                      {!(service.queues || []).length && (
                        <p>No queued entries.</p>
                      )}
                      {(service.dead_letters || []).map((job) => (
                        <p key={job.id}>
                          Needs a person: <Reference value={job.id} label="job" /> ·{" "}
                          {job.attempts} attempts · target {job.target}. It is
                          not replayed automatically.
                        </p>
                      ))}
                    </>
                  )}
                </div>
              </article>
            ))}
            <p>
              Check an unresolved payment from its delivery's payment record.
              A queue count is not proof of a payment outcome.
            </p>
          </section>
        )}
      </Loading>
      <form className="flow-form" onSubmit={pause}>
        <h2>Payment dispatch control</h2>
        <label>
          Dispatch policy
          <select name="paused">
            <option value="true">Pause new dispatch</option>
            <option value="false">Resume dispatch</option>
          </select>
        </label>
        <label>
          Reason
          <textarea
            name="reason"
            required
            minLength="10"
            maxLength="500"
            rows="3"
          />
        </label>
        <button className="secondary" disabled={busy}>
          Apply reviewed dispatch policy
        </button>
      </form>
    </Page>
  );
}

const DEFAULT_MODE =
  import.meta.env.VITE_DEFAULT_MODE === "backend" ? "backend" : "demo";
const readHash = () => location.hash.slice(1) || "/";
export function Workspace() {
  const [path, setPath] = useState(readHash),
    [session, setSession] = useState(null),
    [mode, setModeState] = useState(
      () => sessionStorage.getItem("pvd-mode") || DEFAULT_MODE,
    ),
    [connectionError, setConnectionError] = useState(null),
    // True once the hosted gateway has said it offers a one-click Sandbox workspace.
    [live, setLive] = useState(false);
  const setMode = (next) => {
    sessionStorage.setItem("pvd-mode", next);
    setModeState(next);
  };
  useEffect(() => {
    const listener = () => {
      setPath(readHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", listener);
    currentSession()
      .then((s) => {
        setLive(demoLoginAvailable());
        if (s) {
          setSession(s);
          setMode("backend");
          if (!location.hash)
            navigate(s.role === "buyer" ? "/signin" : "/batches");
        }
      })
      .catch(() => {});
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  const parts = path.split("/").filter(Boolean);
  // The walkthrough route always uses the simulator, whatever was connected before.
  const demo = mode === "demo" || parts[0] === "demo";
  setDemoMode(demo);
  useEffect(() => {
    if (parts[0] === "demo") {
      setMode("demo");
      navigate(`/batches/${DEMO_BATCH_ID}`);
    }
  }, [parts[0]]);
  const localRole = [
    "batches",
    "tasks",
    "new",
    "operations",
    "settings",
    "demo",
    "start",
    "signup",
    "dashboard",
  ].includes(parts[0])
    ? "operator"
    : path.startsWith("/buyer/")
      ? "buyer"
      : ["signin", "privacy"].includes(parts[0]) || (["payments", "support"].includes(parts[0]) && !parts[1])
        ? "operator"
        : sessionStorage.getItem("pvd-preview-role") || "operator";
  const role = session?.role || localRole;
  useEffect(() => {
    if (import.meta.env.DEV && !session)
      sessionStorage.setItem("pvd-preview-role", localRole);
  }, [localRole, session]);
  const id = parts[1];
  const readiness = useData(
    () =>
      demo
        ? null
        : request(
            role === "buyer" && id
              ? `/v1/batches/${id}/financials`
              : "/v1/readiness",
          ),
    [demo, role, id],
  );
  const envKind = demo
    ? "demo"
    : readiness.data?.environment === "fixture"
      ? "fixture"
      : readiness.data?.environment === "sandbox"
        ? "sandbox"
        : "unverified";
  const environment = {
    demo: "Illustrative walkthrough",
    fixture: "Test fixtures",
    // A hosted demo sign-in is a shared Sandbox account, not the visitor's own.
    sandbox: session?.demo ? "Sandbox demo" : "PayPal Sandbox",
    unverified: session?.demo ? "Sandbox demo · unverified" : "Environment unverified",
  }[envKind];
  async function connect() {
    setConnectionError(null);
    try {
      setDemoMode(false);
      await request("/v1/batches?limit=1");
      setMode("backend");
      navigate("/batches");
    } catch (e) {
      setDemoMode(demo);
      setConnectionError(e);
    }
  }
  let screen;
  const openDemo = () => {
    setMode("demo");
    navigate(`/batches/${DEMO_BATCH_ID}`);
  };
  if (!parts.length)
    return (
      <Landing
        connect={connect}
        connectionError={connectionError}
        mode={mode}
        openDemo={openDemo}
        live={live}
      />
    );
  if (parts[0] === "start")
    screen = (
      <Page
        eyebrow="Start here"
        title={<>Run the whole job, <em>one step at a time.</em></>}
        description="A buyer agrees and authorizes with PayPal. You find what was lost, restore it, and capture only what was delivered. Each step below opens the screen where it happens."
      >
        <Start
          envKind={envKind}
          demo={demo}
          openDemo={openDemo}
          connect={connect}
          canConnect={import.meta.env.DEV || !!session}
          demoLogin={!!session?.demo}
          role={session?.role || "operator"}
        />
      </Page>
    );
  else if (parts[0] === "signup")
    screen = (
      <Page
        eyebrow="Start here · Integrate"
        title={<>Create a <em>Sandbox merchant account.</em></>}
        description="For your own integration. You get an API key for your server; your buyers never see it."
      >
        <Signup demo={demo} />
      </Page>
    );
  else if (parts[0] === "demo")
    screen = (
      <Page title="Opening the walkthrough…" description="Loading example records." />
    );
  else if (parts[0] === "batches" && id)
    screen = (
      <CaseWorkspace
        key={`${id}:${mode}`}
        id={id}
        view={["analysis", "settlement", "record", "timeline"].includes(parts[2]) ? parts[2] : ""}
        environment={environment}
        envKind={envKind}
      />
    );
  else if (parts[0] === "buyer" && id && parts[2] !== "agreement")
    screen = (
      <BuyerDelivery
        key={`${id}:${mode}`}
        id={id}
        environment={environment}
        envKind={envKind}
        preview={!session}
      />
    );
  else if (parts[0] === "batches")
    screen = <BatchQueue demo={demo} connect={connect} />;
  else if (parts[0] === "new")
    screen = demo ? (
      <Connections demo connect={connect} />
    ) : (
      <NewBatch session={session} />
    );
  else if (parts[0] === "buyer" && parts[2] === "agreement")
    screen = <Agreement id={id} demo={demo} session={session} />;
  else if (parts[0] === "tasks") screen = <Tasks id={id} />;
  else if (parts[0] === "payments")
    screen = id ? (
      <Payments id={id} role={role} />
    ) : (
      <BatchQueue demo={demo} connect={connect} payments />
    );
  else if (parts[0] === "support")
    screen = id ? (
      <Support id={id} role={role} demo={demo || id === "demo"} />
    ) : (
      <SupportInbox demo={demo} />
    );
  else if (parts[0] === "activity") screen = <Activity id={id} role={role} />;
  else if (parts[0] === "settings")
    screen = <Connections demo={demo} connect={connect} session={session} />;
  else if (parts[0] === "operations") screen = <Operations />;
  else if (parts[0] === "dashboard")
    screen = (
      <Page
        eyebrow="Records · Dashboard"
        title={<>Every delivery, <em>and what it settled to.</em></>}
        description="Clips ordered, delivered and recovered, and how each PayPal hold was split. Rearrange it or add your own widgets."
      >
        <Suspense fallback={<LoadingCard label="Loading the dashboard…" note="The dashboard component is about 1.5 MB. It is fetched once, then kept." />}>
          <Dashboard envKind={envKind} />
        </Suspense>
      </Page>
    );
  else if (parts[0] === "checkout-return" || parts[0] === "checkout-cancel") {
    const batch = sessionStorage.getItem("pvd-checkout");
    screen = (
      <Page
        eyebrow="Your delivery · PayPal"
        title={
          parts[0] === "checkout-cancel"
            ? <>PayPal was closed. <em>Nothing was authorized.</em></>
            : <>Back from PayPal. <em>One check left.</em></>
        }
        description="Coming back from PayPal does not confirm a hold or a charge. Our server checks the authorization with PayPal before anything is shown as authorized."
      >
        {batch ? (
          <ButtonLink to={`/buyer/${batch}/agreement`} primary>
            Check the original authorization
          </ButtonLink>
        ) : (
          <section className="document-panel">
            <p>
              Open the private delivery link your studio sent you to check the authorization.
            </p>
          </section>
        )}
      </Page>
    );
  } else if (parts[0] === "signin")
    screen = (
      <Page
        eyebrow="Assay · Sign in"
        title={<>Sign in to <em>your workspace.</em></>}
        description="Your account decides which deliveries you can open and what you can approve."
      >
        <section className="document-panel">
          <a
            className="primary flow-button"
            href={`/api/login?returnTo=${encodeURIComponent(sessionStorage.getItem("pvd-return") || "/#/batches")}`}
          >
            Continue with your account
          </a>
          {import.meta.env.DEV && (
            <Actions>
              <button className="secondary" onClick={connect}>
                Use local development identities
              </button>
            </Actions>
          )}
          <p>
            Buying a delivery? Use the private delivery link your studio
            sent you.
          </p>
        </section>
      </Page>
    );
  else if (parts[0] === "privacy")
    screen = (
      <Page
        eyebrow="Assay · Privacy and retention"
        title={<>What is kept, <em>and for how long.</em></>}
        description="How files, prompts, payment references and messages are held for a delivery."
      >
        <section className="document-panel">
          <h2>Files and operational records</h2>
          <p>
            Each agreement shows an exact file-retention deadline. Files may
            expire after that deadline. Prompts, private media and payment
            references are restricted to the relevant buyer and merchant.
          </p>
          <h2>AI investigation</h2>
          <p>
            The configured AI provider receives scoped operational observations
            when an operator requests an investigation. AI proposes
            investigations; it cannot set prices or approve payments.
          </p>
          <h2>Support records</h2>
          <p>
            Describe issues without passwords, API keys or private links.
            Messages are kept as long as the delivery's files. Ask your studio
            about access, correction or retention.
          </p>
          <p className="plain-note">
            This is a Sandbox build for evaluation. It describes how the
            product handles data; it is not a legal privacy policy.
          </p>
        </section>
      </Page>
    );
  else
    screen = (
      <Page
        eyebrow="Assay · Not found"
        title={<>This page <em>is not on record.</em></>}
        description="The address does not match a screen or a delivery. Nothing was changed."
      >
        <Actions>
          <ButtonLink to="/batches" primary>Command center</ButtonLink>
          <ButtonLink to="/start">Start here</ButtonLink>
        </Actions>
      </Page>
    );
  if (
    session?.role === "buyer" &&
    ["batches", "tasks", "new", "operations", "settings", "start", "dashboard"].includes(parts[0])
  )
    screen = (
      <Page
        title="This page is for merchants"
        description={
          session.demo
            ? "You are signed in as the demo buyer. The guided steps are read from the merchant's records."
            : "Open your private delivery link to continue."
        }
      >
        {/* Shared Sandbox demo: one visitor plays both sides. */}
        {session.demo && (
          <a
            className="btn btn-proof"
            href={`/api/demo-login?as=operator&returnTo=${encodeURIComponent("/#/start")}`}
          >
            Switch to the demo merchant
          </a>
        )}
      </Page>
    );
  return (
    <ProductShell
      role={role}
      demo={demo}
      session={session}
      environment={environment}
      envKind={envKind}
      path={path}
      batchId={id}
      connect={connect}
    >
      {connectionError && (
        <div className="flow-page">
          <ErrorBox error={connectionError} />
        </div>
      )}
      <Suspense
        fallback={
          <main id="main" className="case-page" aria-busy="true">
            <div className="skeleton skeleton-title" />
            <div className="skeleton skeleton-block" />
            <p className="sr-only" role="status">Loading…</p>
          </main>
        }
      >
        {screen}
      </Suspense>
    </ProductShell>
  );
}
