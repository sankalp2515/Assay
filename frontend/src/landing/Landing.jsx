// Public page, laid out after the Assay design file. The figures are the product's own worked
// example (ten clips at $5, one lost in delivery, two never produced), not the file's placeholder job.
import { useCallback, useEffect, useRef, useState } from "react";
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
import { PayPalLogo, withPayPal } from "../ui/PayPalLogo.jsx";
import { LIVE_DEMO_HREF } from "../api.js";
import POSTER from "../assets/hero/lighthouse-poster.webp";

const REPO = "https://github.com/sankalp2515/Assay";
const FILE = (path) => `${REPO}/blob/main/${path}`;
const HERO_CLIP = "/demo/lighthouse.mp4";

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

// The hero plays the worked example once: six records are read one by one, delivery turns out
// broken, then the clip is re-linked, delivery verified and the money settled. Steps 1-6 read
// the records, 7 re-links the file, 8 verifies delivery, 9 settles.
const LAST = 9;
const WAITING = (s) => ({ ...s, state: "pending", tag: "Reading" });
function stationsAt(step) {
  return BEFORE.map((s, i) => {
    if (step <= i) return WAITING(s);
    if (step >= 9 && (s.key === "payment" || s.key === "settlement")) return AFTER[i];
    if (step >= 8 && s.key === "delivery") return AFTER[i];
    if (step >= 7 && s.key === "artifact") return AFTER[i];
    return s;
  });
}
function useSequence() {
  const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [step, setStep] = useState(still ? LAST : 0);
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (still) return;
    setStep(0);
    // Reading is quick; the break is held long enough to be seen before the recovery.
    const at = [500, 850, 1200, 1550, 1900, 2250, 4300, 5200, 6100];
    const timers = at.map((ms, i) => setTimeout(() => setStep(i + 1), ms));
    // Plays three times on its own, then rests on the settled state until replayed.
    if (run < 2) timers.push(setTimeout(() => setRun((n) => n + 1), 13000));
    return () => timers.forEach(clearTimeout);
  }, [run, still]);
  return { step, replay: useCallback(() => setRun((n) => n + 1), []), still };
}
function useCount(target, ms = 900) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      from.current = target;
      return setValue(target);
    }
    let frame;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const v = Math.round(start + (target - start) * (1 - (1 - p) ** 3));
      setValue(v);
      if (p < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return value;
}
const usd = (cents) => `$${(cents / 100).toFixed(2)}`;

function HeroStage({ step }) {
  const video = useRef(null);
  const restored = step >= 8;
  const held = step >= 2;
  const settled = step >= 9;
  const captured = useCount(settled ? 4000 : 0);
  useEffect(() => {
    // The clip is fetched after first paint; the poster holds the frame until then.
    const v = video.current;
    if (!v || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = setTimeout(() => {
      v.src = HERO_CLIP;
      v.play?.().catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="hero-stage rise" style={{ "--d": "200ms" }}>
      <figure className="hero-clip" data-state={restored ? "restored" : step >= 5 ? "lost" : "reading"}>
        <video ref={video} poster={POSTER} muted loop playsInline preload="none" width="960" height="540" aria-label="A lighthouse on a green headland above a calm sea. AI-generated clip used by the Sandbox demo." />
        <figcaption>
          <span className="eyebrow">{restored ? "Clip 08 · restored original" : step >= 5 ? "Clip 08 · marked failed" : "Clip 08 · reading records"}</span>
          <span className="hero-clip-facts num" aria-live="polite">
            {restored ? <><CheckIcon size={12} weight="bold" aria-hidden="true" />Buyer can open it · SHA-256 match</> : step >= 5 ? <><XIcon size={12} weight="bold" aria-hidden="true" />Rendered and archived · never delivered</> : "Provider · archive · buyer route"}
          </span>
        </figcaption>
      </figure>
      <dl className="hero-ledger">
        <div data-on={held || undefined}>
          <dt>Authorized hold</dt>
          <dd className="num">{held ? "$50.00" : "—"}</dd>
          <span>{held ? "Held in PayPal, not a charge" : "Waiting for the buyer"}</span>
        </div>
        <div data-on={settled || undefined} data-tone="proof">
          <dt>Captured once</dt>
          <dd className="num">{usd(captured)}</dd>
          <span>{settled ? "8 clips the buyer can open" : "Nothing captured yet"}</span>
        </div>
        <div data-on={settled || undefined}>
          <dt>Never taken</dt>
          <dd className="num">{settled ? "$10.00" : "—"}</dd>
          <span>{settled ? "Released. Not a refund." : "2 clips were never made"}</span>
        </div>
      </dl>
      <p className="fineprint">Illustrative sequence. The clip is real LTX-Video output, the one the Sandbox demo delivers.</p>
    </div>
  );
}

const CAPTIONS = [
  ["14:02:10", "Opening the six records for order coastal-024."],
  ["14:02:10", "Agreement: ten clips at $5.00, ceiling $50.00."],
  ["14:02:41", "PayPal: $50.00 authorized. A hold, not a charge."],
  ["14:05:18", "Provider: eight tasks completed, two failed."],
  ["14:05:19", "Archive: eight originals stored with checksums."],
  ["14:08:20", "Buyer route: clip 08 was never published. The app says “failed”."],
  ["14:08:20", "No capture is proposed while delivery is broken."],
  ["14:11:02", "Merchant approves: clip 08 re-linked from the archive. No new render."],
  ["14:11:04", "Buyer route fetched all eight. Bytes match the archive."],
  ["14:12:30", "One capture of $40.00. $10.00 is never taken."],
];
function HeroLine({ step, replay, still }) {
  const done = step >= LAST;
  const broken = step >= 5 && step < 8;
  const stations = stationsAt(step);
  return (
    <div className="hero-trace">
      <div className="hero-trace-bar">
        <p className="eyebrow">Order coastal-024 · ten paid clips · six systems</p>
        <p className="eyebrow hero-trace-state" data-state={done ? "verified" : broken ? "broken" : "pending"} aria-live="polite">
          <span aria-hidden="true" />
          {done ? "Delivery verified · charged once" : broken ? "Records disagree" : step >= 8 ? "Delivery verified · settling" : "Reading six records"}
        </p>
        <p className="hero-caption" key={step}><span className="num">{CAPTIONS[step][0]}</span>{CAPTIONS[step][1]}</p>
        {!still && (
          <button className="btn btn-outline btn-sm" onClick={replay}>
            {done ? <><ArrowCounterClockwiseIcon size={14} aria-hidden="true" />Replay</> : <><ScanIcon size={14} aria-hidden="true" />Start again</>}
          </button>
        )}
      </div>
      <div className="hero-progress" aria-hidden="true">
        {CAPTIONS.slice(1).map((_, i) => <span key={i} data-on={step > i || undefined} data-tone={i === 4 || i === 5 ? "broken" : undefined} />)}
      </div>
      <ol className="hero-line">
        {stations.map((s, i) => (
          <li key={s.key}>
            <span className="hl-node" data-state={s.state} aria-hidden="true">{s.state === "broken" && <span />}</span>
            {i < stations.length - 1 && <span className="hl-link" data-state={link(s, stations[i + 1])} aria-hidden="true" />}
            <article className="sheet" data-state={s.state} data-now={(step === i + 1 || (step === 7 && s.key === "artifact") || (step === 8 && s.key === "delivery") || (step === 9 && s.key === "settlement")) && step < LAST + 1 && !still ? "" : undefined}>
              <div><h3>{s.title}</h3><span className="eyebrow" data-state={s.state}>{s.tag}</span></div>
              <p className="eyebrow">{withPayPal(s.subtitle)}</p>
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
  ["One job through the hosted screens: $50 hold approved in PayPal checkout, clip 08 restored, one $40 capture, signed statement verified", "Real PayPal Sandbox and hosted AI · pre-generated clips", "hosted-sandbox-run.json"],
  ["$50 authorization, $40 final capture, $5 refund on the original capture, and a separate void", "Real PayPal Sandbox · adapter level", "paypal-lifecycle.json"],
  ["Five services with a hosted Gemini model, a real Sandbox buyer approval and one confirmed $40 capture", "Real AI and Sandbox · fixture media", "service-sandbox-workflow.json"],
  ["Concurrency, row-level security, money bounds and encrypted restore", "Native PostgreSQL · local", "native-postgres.json"],
  ["The services running as containers behind public HTTPS", "Hosted Sandbox · no payment in this check", "container-smoke.json"],
  ["The walkthrough on this site", "Illustrative · no services, no money", null],
];
const INCIDENT = BEFORE;
// From backend/evidence/hosted-sandbox-run.json. PayPal Sandbox, test money.
const TAPE = [
  ["paypal.authorization", "$50.00 authorized · 5VS033985C290321J"],
  ["webhook", "PAYMENT.AUTHORIZATION.CREATED · verified · 200"],
  ["delivery.restore", "Clip 08 restored from the archive · no new render"],
  ["kernel.playback", "8 of 8 clips played outside our network · 8 digest matches"],
  ["paypal.capture", "$40.00 captured once · 6LH981233Y3805404"],
  ["webhook", "PAYMENT.CAPTURE.COMPLETED · verified · 200"],
  ["paypal.remainder", "$10.00 never taken · not a refund"],
  ["statement", "EdDSA signature valid · 8 clips charged"],
];
const pad = (n) => String(n).padStart(2, "0");

export function Landing({ openDemo, connect, connectionError, mode, live = false }) {
  useInputMode();
  const seq = useSequence();
  // Sections fade up once as they are reached. Without the observer nothing is hidden.
  useEffect(() => {
    if (!("IntersectionObserver" in window) || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const nodes = [...document.querySelectorAll(".landing .lp-section .lp-wrap > *, .landing .photo-copy, .landing .closing .lp-wrap > *, .landing .steps > li, .landing .reel > li, .landing .quad > div, .landing .controls > li")];
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("in");
        io.unobserve(e.target);
      }),
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    nodes.forEach((n) => {
      if (n.getBoundingClientRect().top < window.innerHeight) return;
      const i = n.parentElement ? [...n.parentElement.children].indexOf(n) : 0;
      n.style.setProperty("--rv-d", `${Math.min(i, 5) * 70}ms`);
      n.classList.add("rv");
      io.observe(n);
    });
    return () => io.disconnect();
  }, []);
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
            <a href="#/" onClick={go("how")}>How it works</a>
            <a href="#/" onClick={go("investigation")}>Investigation</a>
            <a href="#/" onClick={go("clips")}>Clips</a>
            <a href="#/" onClick={go("record")}>Record</a>
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
              <div className="hero-copy">
                <div className="enter">
                  <p className="eyebrow">AI outcome assurance <span className="slash">/</span> for businesses that sell AI-generated work</p>
                  <h1>The model finished.<br /><em className="in-proof">Can you prove</em> your customer got it?</h1>
                </div>
                <p className="hero-lede rise" style={{ "--d": "250ms" }}>When payment, provider, storage and your app disagree, a customer sees <em>“failed”</em> for a video that exists. Assay finds it, restores it, verifies delivery, and settles the money to match.</p>
                <div className="hero-actions rise" style={{ "--d": "350ms" }}>
                  {live ? (
                    <a className="btn btn-proof btn-xl" href={LIVE_DEMO_HREF}>Run it live on <PayPalLogo size="md" /> Sandbox<ArrowRightIcon size={16} aria-hidden="true" /></a>
                  ) : (
                    <button className="btn btn-proof btn-xl" onClick={openDemo}>Watch a recovery<ArrowRightIcon size={16} aria-hidden="true" /></button>
                  )}
                  {live ? (
                    <button className="btn btn-outline btn-xl" onClick={openDemo}>Watch the walkthrough</button>
                  ) : (
                    <a className="btn btn-outline btn-xl" href="#/" onClick={go("evidence")}>See the evidence</a>
                  )}
                </div>
                <p className="hero-under rise" style={{ "--d": "450ms" }}>
                  {live ? "Test money only. You play buyer and merchant; nothing to install." : "Example records in your browser. No account, no money."}{" "}
                  <a className="text-link" href="#/start">Every step, in order</a>
                  {import.meta.env.DEV && mode !== "backend" && <button className="text-link" onClick={connect}>Use local services instead</button>}
                </p>
                {connectionError && <p className="inline-banner" data-tone="failed" role="alert">Local services are not reachable. Start them with <code>npm run demo:ui</code>, or use the walkthrough.</p>}
              </div>
              <HeroStage step={seq.step} />
            </div>
            <HeroLine {...seq} />
          </div>
        </section>

        <section className="tape" aria-label="Records from the hosted Sandbox run on 12 November 2026">
          <div className="tape-inner">
            <p className="eyebrow tape-label"><i aria-hidden="true" />Hosted Sandbox run · 12 Nov</p>
            <div className="tape-track">
              {[false, true].map((copy) => (
                <ul key={String(copy)} aria-hidden={copy || undefined}>
                  {TAPE.map(([k, v]) => <li key={v}><span className="num">{k}</span><b>{v}</b></li>)}
                </ul>
              ))}
            </div>
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
              <p className="lead">PayPal Sandbox only. No live payments and no customer results. Each record below is a file in the public repository.</p>
            </div>
            <ul className="c6 start7 sheet evidence-list">
              {EVIDENCE.map(([claim, kind, file]) => (
                <li key={claim}>
                  <span>{claim}</span>
                  <span className="source">{kind}</span>
                  {file && <a className="text-link" href={`https://github.com/sankalp2515/Assay/blob/main/backend/evidence/${file}`} target="_blank" rel="noopener noreferrer">Open the record<ArrowUpRightIcon size={13} aria-hidden="true" /></a>}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="closing">
          <div className="lp-wrap">
            <div className="cols closing-top">
              <div className="c8">
                <p className="eyebrow">Three minutes · test money only</p>
                <h2>Run the <span className="num">$50</span> → <span className="num">$40</span> case <em>yourself.</em></h2>
                <p className="lead">Ten clips ordered, eight delivered, one of them recovered. One capture for what arrived; the rest of the hold is never taken.</p>
              </div>
              <div className="c4 closing-actions">
                {live ? (
                  <a className="btn btn-proof btn-xl" href={LIVE_DEMO_HREF}><span>Run it live on <PayPalLogo size="md" /> Sandbox</span><ArrowRightIcon size={16} aria-hidden="true" /></a>
                ) : (
                  <button className="btn btn-proof btn-xl" onClick={openDemo}>Follow the recovery<ArrowRightIcon size={16} aria-hidden="true" /></button>
                )}
                {live ? (
                  <button className="btn btn-outline btn-xl" onClick={openDemo}>Watch the walkthrough first<ArrowUpRightIcon size={16} aria-hidden="true" /></button>
                ) : (
                  <a className="btn btn-outline btn-xl" {...workspace}>Open the merchant workspace<ArrowUpRightIcon size={16} aria-hidden="true" /></a>
                )}
                <a className="btn btn-ghost btn-xl" href="#/" onClick={go("evidence")}>See what has been run<ArrowUpRightIcon size={16} aria-hidden="true" /></a>
              </div>
            </div>
            <ProofLine stations={AFTER} animate />
            <div className="gets">
              <div>
                <p className="eyebrow">What a merchant gets</p>
                <ul>
                  <li><CheckIcon size={15} weight="bold" aria-hidden="true" />Clips that were made but lost are found before anyone pays to render them again.</li>
                  <li><CheckIcon size={15} weight="bold" aria-hidden="true" />One PayPal capture for what the buyer can open, approved by you.</li>
                  <li><CheckIcon size={15} weight="bold" aria-hidden="true" />A signed per-clip statement to answer a buyer or a dispute.</li>
                </ul>
              </div>
              <div>
                <p className="eyebrow">What it costs</p>
                <p className="gets-price display">No price list yet.</p>
                <p>Assay is a Sandbox build. Trying it is free and uses test money. Pilot terms would be agreed with each merchant; nothing here is an offer.</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="lp-wrap">
          <p className="lf-sign">Paid. Made. Delivered. <em>Proven.</em></p>
          <div className="lf-top">
            <div className="lf-brand">
              <Brand />
              <p>Finds paid AI work that was made but never delivered, restores it, and charges once for what arrived.</p>
              <p className="lf-status" data-live={live || undefined}>
                <i aria-hidden="true" />
                <span>{live ? "Sandbox is live" : "PayPal Sandbox only"} · last recorded capture 12 Nov 2026 · <a href={FILE("backend/evidence/hosted-sandbox-run.json")} target="_blank" rel="noopener noreferrer">record</a></span>
              </p>
            </div>
            <nav aria-label="Product">
              <p className="eyebrow">Product</p>
              {live ? <a href={LIVE_DEMO_HREF}>Live Sandbox</a> : <a href="#/start">Start here</a>}
              <button onClick={openDemo}>Walkthrough</button>
              <a href="#/" onClick={go("evidence")}>Evidence</a>
              <a href="#/signup">Create an account</a>
            </nav>
            <nav aria-label="Developers">
              <p className="eyebrow">Developers</p>
              <a href={REPO} target="_blank" rel="noopener noreferrer">GitHub</a>
              <a href={FILE("backend/docs/API.md")} target="_blank" rel="noopener noreferrer">API</a>
              <a href={FILE("backend/docs/postman/assay-merchant.postman_collection.json")} target="_blank" rel="noopener noreferrer">Postman collection</a>
              <a href={FILE("backend/sdk/README.md")} target="_blank" rel="noopener noreferrer">Node SDK</a>
              <a href={FILE("backend/src/mcp/server.ts")} target="_blank" rel="noopener noreferrer">MCP server</a>
            </nav>
            <nav aria-label="Proof">
              <p className="eyebrow">Proof</p>
              <a href={FILE("backend/evidence/hosted-sandbox-run.json")} target="_blank" rel="noopener noreferrer">Hosted run</a>
              <a href={FILE("backend/docs/SECURITY_REVIEW.md")} target="_blank" rel="noopener noreferrer">Security review</a>
              <a href={FILE("backend/docs/ARCHITECTURE.md")} target="_blank" rel="noopener noreferrer">Architecture</a>
              <a href="#/privacy">Privacy and retention</a>
            </nav>
          </div>
          <div className="lf-built">
            <p className="eyebrow">Built with</p>
            <ul>
              <li><PayPalLogo size="md" /><small>holds, captures, webhooks</small></li>
              <li><strong>KERNEL</strong><small>outside playback check</small></li>
              <li><strong>Postman</strong><small>API collection and runs</small></li>
              <li><strong>Bryntum</strong><small>recovery window</small></li>
              <li><strong>AG Grid</strong><small>dashboard</small></li>
              <li><strong>APIMatic</strong><small>PayPal contract review</small></li>
              <li><strong>Render</strong><small>static page hosting</small></li>
            </ul>
          </div>
          <div className="lf-base">
            <p className="eyebrow">PayPal Sandbox build · test money only · no live payments</p>
            <a href="#/signin">Sign in</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
