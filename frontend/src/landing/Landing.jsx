// Public page, laid out after the Assay design file. The figures are the product's own worked
// example (ten clips at $5, one lost in delivery, two never produced), not the file's placeholder job.
import { useEffect, useState } from "react";
import {
  ArrowRightIcon,
  ArrowCounterClockwiseIcon,
  ArrowUpRightIcon,
  CheckIcon,
  CircleDashedIcon,
  ClockIcon,
  LockIcon,
  ScalesIcon,
  ScanIcon,
  ShieldCheckIcon,
  SparkleIcon,
  UserCheckIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Brand, ThemeToggle, useInputMode } from "../ui/ProductShell.jsx";
import { ProofLine } from "../ui/ProofLine.jsx";
import { DARKROOM, STILLS } from "../ui/stills.jsx";
import { scrollBehavior } from "../ui/kit.jsx";
import "../case/case.css";
import "./landing.css";

const TITLES = { agreement: "Agreement", payment: "Payment", execution: "Execution", artifact: "Artifact", delivery: "Delivery", settlement: "Settlement" };
const SUB = { agreement: "Merchant app", payment: "PayPal", execution: "Provider", artifact: "Archive", delivery: "Buyer route", settlement: "PayPal" };
const station = (key, state, tag, lines) => ({ key, state, tag, lines, title: TITLES[key], subtitle: SUB[key], value: lines[0] });

const BEFORE = [
  station("agreement", "verified", "Agreed", ["10 clips · $5.00 each", "Ceiling $50.00"]),
  station("payment", "pending", "Authorized", ["$50.00 authorized", "Not captured"]),
  station("execution", "verified", "Completed", ["8 of 10 tasks done", "2 failed at provider"]),
  station("artifact", "verified", "Exists", ["8 originals stored", "Checksums recorded"]),
  station("delivery", "broken", "Failed", ["Clip 08 never published", "“Generation failed”"]),
  station("settlement", "pending", "Unsettled", ["Nothing captured", "Waiting on delivery"]),
];
const AFTER = [
  BEFORE[0],
  station("payment", "verified", "Captured once", ["$40.00 of $50.00", "One capture"]),
  BEFORE[2],
  station("artifact", "verified", "Re-linked", ["Clip 08 original", "No regeneration"]),
  station("delivery", "verified", "Verified", ["8 fetched by buyer route", "Bytes match archive"]),
  station("settlement", "verified", "Settled", ["$40.00 captured", "$10.00 never taken"]),
];
const link = (a, b) => (a.state === "broken" || b.state === "broken" ? "broken" : a.state === "verified" && b.state === "verified" ? "verified" : "pending");

function HeroLine() {
  const [done, setDone] = useState(false);
  const stations = done ? AFTER : BEFORE;
  return (
    <div className="hero-trace">
      <div className="hero-trace-bar">
        <p className="eyebrow">Batch coastal-024 · ten paid clips · six systems</p>
        <p className="eyebrow hero-trace-state" data-state={done ? "verified" : "broken"} aria-live="polite">
          <span aria-hidden="true" />
          {done ? "Delivery verified · money aligned" : "Records disagree"}
        </p>
        <button className="btn btn-outline btn-sm" onClick={() => setDone(!done)}>
          {done ? <><ArrowCounterClockwiseIcon size={14} aria-hidden="true" />Reset</> : <><ScanIcon size={14} aria-hidden="true" />Trace this job</>}
        </button>
      </div>
      <ol className="hero-line">
        {stations.map((s, i) => (
          <li key={s.key}>
            <span className="hl-node" data-state={s.state} aria-hidden="true">{s.state === "broken" && <span />}</span>
            {i < stations.length - 1 && <span className="hl-link" data-state={link(s, stations[i + 1])} aria-hidden="true" />}
            <article className="sheet" data-state={s.state}>
              <div><h3>{s.title}</h3><span className="eyebrow" data-state={s.state}>{s.tag}</span></div>
              <p className="eyebrow">{s.subtitle}</p>
              <div className="hl-lines"><p className="num">{s.lines[0]}</p><p className="num">{s.lines[1]}</p></div>
            </article>
          </li>
        ))}
      </ol>
      <p className="fineprint">Illustrative data. In the product, delivery and capture turn verified only when the buyer-route fetch and the PayPal confirmation are observed.</p>
    </div>
  );
}

const Concept = ({ children, className = "" }) => <span className={`concept ${className}`}><span aria-hidden="true" />{children}</span>;
const TONE_ICON = { pending: ClockIcon, broken: XIcon, verified: CheckIcon, proof: CircleDashedIcon };
function Pill({ tone, children }) {
  const Icon = TONE_ICON[tone];
  return <span className="pill" data-tone={tone}><Icon size={12} weight="bold" aria-hidden="true" />{children}</span>;
}

const QUESTIONS = [
  "Did the generation actually fail?",
  "Was a usable video produced, and where is it?",
  "Was the customer charged correctly?",
  "Would a retry pay for the same render twice?",
  "Restore the video, or act in PayPal?",
  "How do you prove it was resolved?",
];
const BELIEFS = [
  ["PayPal", "$50.00 authorized", "Unsettled", "pending"],
  ["Model provider", "8 of 10 completed", "Consistent", "verified"],
  ["Object storage", "8 originals exist · digests recorded", "Consistent", "verified"],
  ["Delivery route", "7 of 10 published", "Contradicts", "broken"],
  ["Your app", "Clip 08 status: FAILED", "Contradicts", "broken"],
  ["Your customer", "“Generation failed”", "Contradicts", "broken"],
];
const STEPS = [
  ["Discover", "Continuously compare what was promised, paid, executed, stored and delivered. Disagreements become incidents.", <Pill tone="broken">Delivery ≠ Execution</Pill>],
  ["Investigate", "Assemble every observation into one trace. AI proposes explanations, clearly separated from what is observed.", <span className="tag-pair"><span className="tag-observed">Observed</span><span className="tag-inferred">AI inference</span></span>],
  ["Recover", "Re-link the output that already exists. No regeneration, no new model cost. Then verify the customer can open it.", <Pill tone="verified">Fetched on buyer route</Pill>],
  ["Settle", "Approve one exact amount. PayPal captures it once, matching what was actually delivered.", <Pill tone="proof">Merchant approved</Pill>],
];
const RECORD = [
  ["Agreement", "10 × clip · ≥720p · $5.00 each", "contract"],
  ["Payment", "PayPal authorization · $50.00", "PayPal"],
  ["Execution", "Provider · 8 tasks completed, 2 failed", "provider.tasks"],
  ["Artifact", "8 originals · sha256 matches manifest", "delivery.archive"],
  ["Delivery", "8 fetched on the buyer route · 200", "delivery.receipts"],
  ["Settlement", "$40.00 captured · $10.00 never taken", "PayPal"],
];
const MERCHANT = [
  ["Stop paying twice for one render", "Recover outputs that already exist instead of regenerating them on every retry."],
  ["Stop refunding work that exists", "Restore the customer's video first. Money moves only when delivery truly failed."],
  ["Answer support with proof", "Show the customer exactly which clips were produced, restored and opened."],
  ["Keep PayPal exact", "Capture what was delivered, release what wasn't, and never call a release a refund."],
];
const CONTROLS = [
  [UserCheckIcon, "AI proposes. You decide.", "No restore, capture or refund happens without explicit merchant approval."],
  [ShieldCheckIcon, "Capture after proof", "A PayPal capture is proposed only after customer delivery is independently verified."],
  [ScalesIcon, "Uncaptured is not refunded", "Authorized money that was never earned is released. It is never charged, then returned."],
  [LockIcon, "Read-first by design", "Assay observes your systems. Writes are scoped, explicit and recorded with their outcome."],
];
const EVIDENCE = [
  ["$50 authorization, $40 final capture, $5 refund on the original capture, and a separate void", "Real PayPal Sandbox · adapter level"],
  ["Five services with a hosted Gemini model, a real Sandbox buyer approval and one confirmed $40 capture", "Real AI and Sandbox · fixture media"],
  ["Concurrency, row-level security, money bounds and encrypted restore", "Native PostgreSQL · local"],
  ["The walkthrough on this site", "Illustrative · no services, no money"],
];
const INCIDENT = BEFORE;
const pad = (n) => String(n).padStart(2, "0");

export function Landing({ openDemo, connect, connectionError, mode }) {
  useInputMode();
  useEffect(() => {
    document.title = "Assay · From payment to proof of delivery";
  }, []);
  const go = (id) => (e) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: scrollBehavior() });
  };
  const workspace = mode === "backend" ? { href: "#/batches" } : { href: "#/demo", onClick: (e) => { e.preventDefault(); openDemo(); } };
  return (
    <div className="landing">
      <a className="skip-link" href="#landing-main" onClick={(e) => { e.preventDefault(); document.getElementById("landing-main")?.focus(); }}>Skip to content</a>
      <header className="landing-nav">
        <div className="lp-wrap">
          <Brand />
          <span className="eyebrow nav-kicker">AI outcome assurance</span>
          <nav aria-label="Page sections">
            <a href="#/" onClick={go("how")}>Product</a>
            <a href="#/" onClick={go("investigation")}>Investigation</a>
            <a href="#/" onClick={go("clips")}>Recovery</a>
            <a href="#/" onClick={go("record")}>Settlement</a>
            <a href="#/" onClick={go("evidence")}>Evidence</a>
          </nav>
          <ThemeToggle />
          <a className="btn btn-ink" {...workspace}>{mode === "backend" ? "Open workspace" : "Open demo"}<ArrowUpRightIcon size={14} aria-hidden="true" /></a>
        </div>
      </header>

      <main id="landing-main" tabIndex={-1}>
        <section className="hero">
          <div className="grid-paper hero-paper" aria-hidden="true" />
          <div className="lp-wrap">
            <div className="hero-top">
              <div className="enter hero-copy">
                <p className="eyebrow">AI outcome assurance <span className="slash">/</span> for businesses that sell AI-generated work</p>
                <h1>The model finished.<br /><em className="in-proof">Can you prove</em> your<br className="wide-break" /> customer got it?</h1>
              </div>
              <div className="hero-side">
                <p className="rise" style={{ "--d": "300ms" }}>Payments, models, queues, storage and your app each keep their own version of the truth. When they disagree, customers see <em>“failed”</em> for work you already paid to generate.</p>
                <p className="rise ink" style={{ "--d": "400ms" }}>Assay finds the work, restores it, verifies delivery, and settles the money to match.</p>
                <div className="hero-actions rise" style={{ "--d": "500ms" }}>
                  <button className="btn btn-proof btn-xl" onClick={openDemo}>Watch a recovery<ArrowRightIcon size={16} aria-hidden="true" /></button>
                  <a className="btn btn-outline btn-xl" href="#/" onClick={go("evidence")}>See the evidence</a>
                </div>
                <a className="text-link" href="#/start">Try every step yourself</a>
                {import.meta.env.DEV && mode !== "backend" && <button className="text-link" onClick={connect}>Use local services instead</button>}
                {connectionError && <p className="inline-banner" data-tone="failed" role="alert">Local services are not reachable. Start them with <code>npm run demo:ui</code>, or use the walkthrough.</p>}
              </div>
            </div>
            <HeroLine />
          </div>
        </section>

        <section className="photo">
          <img src={DARKROOM} alt="A strip of film suspended above a developing tray under amber safelight, one frame emerging" width="1600" height="907" loading="lazy" decoding="async" />
          <div className="photo-shade" aria-hidden="true" />
          <div className="lp-wrap">
            <div className="photo-copy">
              <p className="eyebrow">The lost-delivery problem</p>
              <h2><span className="strike">Generation failed.</span><br />It didn't. It was <em>never delivered.</em></h2>
              <p>The model rendered the video. Storage kept it. A single dropped hand-off told your app it failed, so your customer asks for a retry or a refund, and you pay again for a render that already exists.</p>
              <Concept>Concept imagery</Concept>
            </div>
          </div>
        </section>

        <section className="lp-section" id="problem">
          <div className="lp-wrap cols">
            <div className="c5">
              <p className="eyebrow">01 — The commercial problem</p>
              <h2>Six systems.<br />Six versions of the truth.</h2>
              <p className="lead">Payment and subscription tools track purchases and entitlements. None of them can tell you whether the paid AI work actually reached the person who paid for it.</p>
              <ul className="questions">
                {QUESTIONS.map((q, i) => <li key={q}><span className="num">{pad(i + 1)}</span>{q}</li>)}
              </ul>
            </div>
            <div className="c6 start7">
              <div className="sheet beliefs">
                <div className="beliefs-head"><span className="eyebrow">What each system believes at 14:08</span><Concept>Illustrative data</Concept></div>
                <ul>
                  {BELIEFS.map(([who, says, verdict, tone]) => (
                    <li key={who}>
                      <div><strong>{who}</strong><span className="num">{says}</span></div>
                      <Pill tone={tone}>{verdict}</Pill>
                    </li>
                  ))}
                </ul>
                <p className="hatch-muted beliefs-foot"><strong>The truth is distributed.</strong> Assay joins it into one commercial record: per clip, per customer, per dollar.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-section tinted" id="how">
          <div className="lp-wrap">
            <div className="how-head">
              <div>
                <p className="eyebrow">02 — How Assay resolves it</p>
                <h2>From payment to <em>proof of delivery.</em></h2>
              </div>
              <div className="how-thread">
                <ProofLine stations={INCIDENT} size="mini" />
                <p className="eyebrow">The thread every incident follows</p>
              </div>
            </div>
            <ol className="steps">
              {STEPS.map(([title, body, tag], i) => (
                <li key={title}>
                  <span className="num">{pad(i + 1)}</span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                  <div className="step-tag">{tag}</div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="lp-section" id="clips">
          <div className="lp-wrap">
            <div className="how-head">
              <div>
                <p className="eyebrow">Recovery — what the customer sees</p>
                <h2>Ten clips ordered. <em>Eight delivered. Eight charged.</em></h2>
              </div>
              <Concept>Concept frames · illustrative data</Concept>
            </div>
            <ol className="reel">
              {STILLS.map((s, i) => {
                const state = i === 7 ? "recovered" : i > 7 ? "missing" : "ok";
                return (
                  <li key={i} data-state={state}>
                    <span className={`reel-frame${state === "missing" ? " hatch-muted" : ""}`}>
                      {state !== "missing" && <img src={s.src} alt="" loading="lazy" decoding="async" />}
                      <span className="num">{pad(i + 1)}</span>
                      {state === "recovered" && <span className="reel-badge">Recovered</span>}
                    </span>
                    <strong>{state === "missing" ? "No file produced" : s.title}</strong>
                    <span>{state === "recovered" ? "Hand-off lost · original restored" : state === "missing" ? "Not delivered · not charged" : "Delivered · $5.00"}</span>
                  </li>
                );
              })}
            </ol>
            <p className="reel-foot"><strong className="num">$40.00</strong> captured once for eight clips the customer can open. <strong className="num">$10.00</strong> of the authorization was never taken. That is not a refund.</p>
          </div>
        </section>

        <section className="lp-section" id="record">
          <div className="lp-wrap cols wide-gap">
            <div className="c5">
              <p className="eyebrow">03 — One commercial record</p>
              <h2>Money, model, file and customer, <em>on one line.</em></h2>
              <p className="lead">Every paid job becomes a record that links the financial transaction to the AI execution, the artifact it produced and the moment the customer actually received it. Each line cites its source.</p>
            </div>
            <div className="c7">
              <div className="sheet record-sheet">
                <div className="record-top">
                  <div><p className="eyebrow">Commercial record</p><p className="record-name">Order coastal-024</p></div>
                  <Concept>Illustrative data</Concept>
                </div>
                <ol className="record-line">
                  {RECORD.map(([k, v, src]) => (
                    <li key={k}><span className="rl-node" aria-hidden="true" /><span className="eyebrow">{k}</span><span className="num">{v}</span><span className="source">{src}</span></li>
                  ))}
                </ol>
                <p className="record-foot"><CheckIcon size={16} weight="bold" aria-hidden="true" />Paid, produced, delivered and settled. Each step observed, none assumed.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-section dark" id="investigation">
          <div className="lp-wrap cols">
            <div className="c4">
              <p className="eyebrow">04 — Inside the investigation</p>
              <h2>Facts in ink. <em>Guesses</em> in hatching.</h2>
              <p className="lead">The workspace never lets an AI hypothesis pass as evidence. Observations cite their source. Inferences are marked unverified and say what would confirm them. Every financial action waits for you.</p>
              <button className="btn btn-light" onClick={openDemo}>Open the investigation<ArrowUpRightIcon size={15} aria-hidden="true" /></button>
            </div>
            <div className="c8">
              <div className="mock">
                <div className="mock-bar">
                  <span className="num">coastal-024</span>
                  <strong>Paid clip marked failed, provider reports success</strong>
                  <span className="pill" data-tone="inferred"><SparkleIcon size={12} aria-hidden="true" />Approval required</span>
                </div>
                <div className="mock-line"><ProofLine stations={INCIDENT} animate /></div>
                <div className="mock-body">
                  <div className="mock-events">
                    {[["14:05:18", "Provider reports clip 08 completed", "provider.tasks"], ["14:05:19", "Clip 08 archived, never published", "delivery.archive"], ["14:08:20", "App marks clip 08 failed", "app.jobs"]].map(([t, title, src]) => (
                      <div key={t} className="mock-event">
                        <span className="num">{t}</span>
                        <div><p>{title} <span className="tag-observed">Observed</span></p><span className="source">{src}</span></div>
                      </div>
                    ))}
                    <div className="hatch-inferred mock-hyp">
                      <p className="mock-hyp-head"><SparkleIcon size={14} aria-hidden="true" />H1 · Likely</p>
                      <p>The completion hand-off for clip 08 was lost.</p>
                      <p className="mock-hyp-note">Unconfirmed. Restoring is safe either way.</p>
                    </div>
                  </div>
                  <div className="mock-artifact">
                    <div className="mock-still">
                      <img src={STILLS[7].src} alt="Illustrative recovered render: surf breaking over dark basalt" loading="lazy" decoding="async" />
                      <span className="eyebrow">Clip 08 · exists</span>
                    </div>
                    <ul>
                      <li><CheckIcon size={14} weight="bold" aria-hidden="true" />Re-link the existing video</li>
                      <li><CheckIcon size={14} weight="bold" aria-hidden="true" />Verify the customer can open it</li>
                      <li data-you><UserCheckIcon size={14} aria-hidden="true" />Approve the restore</li>
                      <li data-you><UserCheckIcon size={14} aria-hidden="true" />Capture $40.00 after delivery</li>
                    </ul>
                  </div>
                </div>
              </div>
              <Concept className="on-dark">Product concept · illustrative data</Concept>
            </div>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-wrap cols">
            <div className="c4">
              <p className="eyebrow">05 — For independent AI merchants</p>
              <h2 className="smaller">Built for studios that sell renders, not for platform teams.</h2>
            </div>
            <div className="c8 quad">
              {MERCHANT.map(([t, b], i) => (
                <div key={t}><span className="num">{pad(i + 1)}</span><h3>{t}</h3><p>{b}</p></div>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section tinted">
          <div className="lp-wrap">
            <p className="eyebrow">06 — Trust &amp; financial controls</p>
            <div className="cols trust">
              <h2 className="c5">The software that moves money should be the most <em>honest</em> thing in the room.</h2>
              <ul className="c7 controls">
                {CONTROLS.map(([Icon, t, b]) => (
                  <li key={t}><Icon size={20} aria-hidden="true" /><h3>{t}</h3><p>{b}</p></li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="lp-section" id="evidence">
          <div className="lp-wrap cols">
            <div className="c5">
              <p className="eyebrow">07 — What has actually been run</p>
              <h2 className="smaller">Each claim says <em>what kind of evidence it is.</em></h2>
              <p className="lead">PayPal Sandbox only. Not deployed, no live payments, no customer results. The production video provider adapter is not yet configured.</p>
            </div>
            <ul className="c6 start7 sheet evidence-list">
              {EVIDENCE.map(([claim, kind]) => <li key={claim}><span>{claim}</span><span className="source">{kind}</span></li>)}
            </ul>
          </div>
        </section>

        <section className="closing">
          <div className="lp-wrap">
            <div className="cols closing-top">
              <div className="c8">
                <p className="eyebrow">Three-minute demo</p>
                <h2>Watch a paid video come back from <em>“failed.”</em></h2>
              </div>
              <div className="c4 closing-actions">
                <button className="btn btn-proof btn-xl" onClick={openDemo}>Follow the recovery<ArrowRightIcon size={16} aria-hidden="true" /></button>
                <a className="btn btn-outline btn-xl" {...workspace}>Open the merchant workspace<ArrowUpRightIcon size={16} aria-hidden="true" /></a>
                <a className="btn btn-ghost btn-xl" href="#/" onClick={go("evidence")}>See what has been run<ArrowUpRightIcon size={16} aria-hidden="true" /></a>
              </div>
            </div>
            <ProofLine stations={AFTER} animate />
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="lp-wrap">
          <Brand />
          <p>Investigates whether paid AI work was delivered, recovers what exists, and proves the charge is right.</p>
          <nav aria-label="Footer">
            <button onClick={openDemo}>Walkthrough</button>
            <a href="#/start">Start here</a>
            <a href="#/signin">Sign in</a>
            <a href="#/privacy">Privacy and retention</a>
          </nav>
          <p className="eyebrow">A PayPal AI Hackathon 2026 entry · PayPal Sandbox only</p>
        </div>
      </footer>
    </div>
  );
}
