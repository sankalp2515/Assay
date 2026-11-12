// Merchant case: investigation, AI analysis, settlement and resolution record for one delivery.
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import {
  ClockIcon,
  ArrowRightIcon,
  ArrowClockwiseIcon,
  CheckIcon,
  DownloadSimpleIcon,
  FileVideoIcon,
  LockIcon,
  SealCheckIcon,
  SparkleIcon,
  SpinnerGapIcon,
  UserIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { approvalExpired, money, paymentSummary } from "../domain.js";
import { Notice } from "../ui/Notice.jsx";
import { AuthorizationHandoff } from "../ui/AuthorizationHandoff.jsx";
import { ProofLine } from "../ui/ProofLine.jsx";
import { Chip, Countdown, LoadingCard, Modal, Reference, Screening, clock, formatBytes, scrollBehavior, stamp } from "../ui/kit.jsx";
import { buildStations, buildTimeline, buildUnits, buildUnknowns, clipName, nextStep, stationOf, STATE_WORD } from "./model.js";
import { useArtifactMedia, useCase } from "./useCase.js";
import { Thumb, stillFor } from "../ui/stills.jsx";
import "./case.css";
import { PayPalLogo } from "../ui/PayPalLogo.jsx";

// Bryntum is large; it loads only when the recovery window is opened.
const Timeline = lazy(() => import("./Timeline.jsx"));

const pad = (n) => String(n).padStart(2, "0");
const SOURCE_LABEL = { commerce: "contract", provider: "provider.tasks", delivery: "delivery.archive", payments: "paypal" };
const PROVENANCE = {
  real: "Hosted model",
  fixture: "Fixture model, not a real AI run",
  illustrative: "Illustrative walkthrough, not a model",
};

export function titleOf(batch) {
  return batch.title || `Untitled delivery ${batch.id.slice(0, 8)}`;
}
function downloadJson(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Models refer to clips by their internal unit ID. Show the clip number a person can use;
// the words are otherwise untouched.
export function nameClips(text, units) {
  let out = String(text || "");
  for (const u of units) out = out.split(u.id).join(`clip ${pad(u.index + 1)}`);
  return out.replace(/(^|[^A-Za-z])[Uu]nit (clip [0-9][0-9])/g, "$1$2").replace(/^clip /, "Clip ").replace(/([.!?] )clip /g, "$1Clip ");
}

/* What the delivery is, in one headline. Words only, derived from records. */
function headline(ctx) {
  const { units, finance, batch } = ctx;
  const fmt = (n) => money(n, batch.currency);
  const lost = units.filter((u) => u.recoverable);
  const ready = units.filter((u) => u.published);
  if (finance.state === "CONFIRMED")
    return finance.operation.kind === "VOID"
      ? [<>Nothing delivered. <em>Nothing charged.</em></>, `No clip met the delivery terms, so the ${fmt(batch.ceiling_minor)} authorization was released.`]
      : [<>Found, delivered and <em>charged once.</em></>, `${ready.length} of ${units.length} clips reached the buyer. ${fmt(paymentSummary(ctx.operations).captured)} was captured and ${fmt(batch.ceiling_minor - paymentSummary(ctx.operations).captured)} was never taken.`];
  if (finance.state !== "DRAFT")
    return [<>Capture sent. <em>Not confirmed yet.</em></>, "Until PayPal read-back confirms it, this is pending everywhere. Pending is not paid."];
  // While finished clips are still being copied into the archive, the counts are moving:
  // never invite a settlement yet.
  const up = (v) => String(v || "").toUpperCase();
  const archiving = units.filter((u) => up(u.artifact?.state) === "COPYING" || (up(u.attempt?.state) === "SUCCEEDED" && !u.artifact));
  if (archiving.length)
    return [<>Archiving {archiving.length} finished {archiving.length === 1 ? "clip" : "clips"}. <em>One moment.</em></>, `${ready.length} of ${units.length} delivered so far. Assay copies each finished clip from the provider before the provider deletes it. This page updates itself.`];
  if (lost.length)
    return [<>The app said <span className="strike">failed</span>. <em>The video exists.</em></>, `The provider finished clip ${lost.map((u) => pad(u.index + 1)).join(", ")} and the archive holds the file, but it was never published to the buyer. ${ready.length} of ${units.length} clips are reachable.`];
  if (ready.length)
    return [<>{ready.length} of {units.length} delivered. <em>Ready to settle.</em></>, `The buyer can open ${ready.length} clips. Capture only those against the ${fmt(batch.ceiling_minor)} authorization.`];
  return [<>Nothing has reached <em>the buyer yet.</em></>, "No clip is published on the buyer route. Nothing is billable until one is."];
}

function useCaseContext(id) {
  const c = useCase(id, "operator");
  const data = c.data;
  const derived = useMemo(() => {
    if (!data) return null;
    const reviewKnown = !!data.review && !data.review.unavailable;
    const units = buildUnits({ ...data, receipts: c.receipts, statement: data.statement?.statement });
    const operations = c.finance.operation && !data.operations.length ? [c.finance.operation] : data.operations;
    const shared = { batch: data.batch, units, financials: data.financials, operations, assessment: data.assessment, reviewKnown };
    return {
      ...shared,
      stations: buildStations(shared),
      step: nextStep(shared),
      unknowns: buildUnknowns(shared),
      timeline: buildTimeline({ ...data, receipts: c.receipts }),
      finance: c.finance,
    };
  }, [data, c.receipts, c.finance]);
  return { c, data, derived };
}

function CaseHeader({ batch, ctx, view, envLabel, children }) {
  const [title, lead] = headline(ctx);
  const titles = {
    analysis: [<>Why did finished work <em>look failed?</em></>, "What the systems recorded is kept apart from what the AI thinks happened. Nothing in the second column is evidence."],
    settlement: null,
    timeline: [<>What can still be saved, <em>and until when.</em></>, "Each clip's provider copy, Assay's archived copy and the PayPal hold on one clock. Solid bars are records. Dashed bars are estimates from published terms."],
    record: [<>What happened, <em>and how we know.</em></>, "A plain-language record of this delivery. Each claim cites the system that observed it. Anything not proven stays marked as open."],
  };
  const fmt = (n) => money(n, batch.currency);
  const eligible = ctx.units.filter((u) => u.published).reduce((n, u) => n + u.price_minor, 0);
  const settled = ctx.finance.state === "CONFIRMED";
  const [t, l] =
    view === "settlement"
      ? [settled
          ? <>Captured <span className="in-proof">{fmt(paymentSummary(ctx.operations).captured)}</span> of a {fmt(batch.ceiling_minor)} authorization.</>
          : <>Capture <span className="in-proof">{fmt(eligible)}</span> of a {fmt(batch.ceiling_minor)} authorization.</>,
         `The buyer authorized up to ${fmt(batch.ceiling_minor)} for ${ctx.units.length} clips. ${ctx.units.filter((u) => u.published).length} are delivered and retrievable. You only charge for what was delivered.`]
      : titles[view] || [title, lead];
  return (
    <header className="page-head enter">
      <div>
        <p className="eyebrow">
          <span>{{ "": "Investigation", analysis: "AI analysis", settlement: "Settlement", timeline: "Recovery window", record: "Resolution record" }[view]}</span>
          <span>/</span>
          <span>{titleOf(batch)}</span>
          <span>/</span>
          <span>Opened {stamp(batch.created_at)}</span>
        </p>
        <h1>{t}</h1>
        <p className="lead">{l}</p>
      </div>
      <div className="actions">{children}</div>
    </header>
  );
}

function StateChip({ ctx }) {
  const f = ctx.finance;
  if (f.state === "CONFIRMED") return <Chip tone="confirmed">{f.operation.kind === "VOID" ? "Released" : "Resolved"}</Chip>;
  if (f.state === "UNKNOWN") return <Chip tone="unknown">Outcome unknown</Chip>;
  if (f.state === "PENDING") return <Chip tone="pending">Awaiting PayPal</Chip>;
  if (["restore", "settle"].includes(ctx.step.kind)) return <Chip tone="ai">Approval required</Chip>;
  return <Chip tone="pending">Investigating</Chip>;
}

/* ---------- Investigation ---------- */
function Evidence({ ctx, station, scoped, setScoped, assessment }) {
  const [kind, setKind] = useState("all");
  const stationTitle = ctx.stations.find((s) => s.key === station)?.title;
  const rows = [
    ...ctx.timeline.filter((e) => e.source !== "AI").map((e) => ({ ...e, station: stationOf(e), observed: true })),
    ...ctx.units.filter((u) => u.recoverable).map((u) => ({
      at: null,
      source: "Delivery",
      title: `Clip ${pad(u.index + 1)} archived, not published to the buyer`,
      detail: "The original exists in the archive. The buyer route has no file for it.",
      reference: u.artifact?.id,
      tone: "failed",
      station: "delivery",
      observed: true,
    })),
    ...(assessment?.assessment?.hypotheses || []).map((h, i) => ({
      at: assessment.completed_at || assessment.created_at,
      source: "Assay analysis",
      title: `Hypothesis H${i + 1}`,
      detail: nameClips(h.description, ctx.units),
      reference: "not verified",
      observed: false,
      station: "delivery",
    })),
  ];
  const only = scoped && station;
  const shown = rows.filter((r) => (!only || r.station === station || (!r.observed && station === "delivery")) && (kind === "all" || (kind === "observed") === r.observed));
  return (
    <section className="sheet" aria-labelledby="evidence-title">
      <div className="sheet-head">
        <h2 id="evidence-title">Evidence timeline</h2>
        <div className="seg" role="group" aria-label="Kind of entry">
          {[["all", "All"], ["observed", "Observed"], ["inferred", "AI inference"]].map(([v, l]) => (
            <button key={v} aria-pressed={kind === v} onClick={() => setKind(v)}>{l}</button>
          ))}
        </div>
      </div>
      <p className="evidence-scope">
        <span>Showing <strong>{only ? stationTitle : "all stations"}</strong> · {shown.length} of {rows.length}</span>
        {only ? <button className="text-link" onClick={() => setScoped(false)}>Show all stations</button> : station ? <button className="text-link" onClick={() => setScoped(true)}>Only {stationTitle}</button> : null}
      </p>
      {shown.length ? (
        <ol className="evidence">
          {shown.map((e, i) => (
            <li key={i} className={e.observed ? undefined : "hatch-inferred"} data-tone={e.tone === "failed" ? "failed" : undefined} data-here={!only && station && e.station === station ? "" : undefined}>
              <time className="num" dateTime={e.at}>{clock(e.at)}</time>
              <div>
                <p className="evidence-title"><strong>{e.title}</strong><span>· {e.source}</span></p>
                {e.detail && <p>{e.detail}</p>}
                {e.reference && <span className="source">{e.reference}</span>}
              </div>
              {e.observed ? <span className="tag-observed">Observed</span> : <span className="tag-inferred">AI inference</span>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty-line">No {kind === "inferred" ? "AI inference" : "record"} at this station yet.{kind !== "observed" && !assessment ? " Run the investigation to add the AI's reading." : ""}</p>
      )}
    </section>
  );
}

function ClipLedger({ units, selected, onSelect }) {
  return (
    <section className="sheet" aria-labelledby="ledger-title">
      <div className="sheet-head">
        <h2 id="ledger-title">Clip ledger</h2>
        <span className="eyebrow">Select a clip to inspect its file</span>
      </div>
      <div className="ledger-scroll">
        <table className="unit-ledger">
          <thead>
            <tr><th scope="col">Clip</th><th scope="col">Execution</th><th scope="col">Artifact</th><th scope="col">Delivery</th><th scope="col" className="r">Billing</th></tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id} data-selected={selected === u.index || undefined}>
                <th scope="row">
                  <button className="unit-select num" aria-pressed={selected === u.index} aria-label={`Inspect clip ${pad(u.index + 1)}: ${u.access.label}, ${u.billing.label}`} onClick={() => onSelect(u.index)}>
                    <Thumb index={u.index} exists={!!u.artifact} dim={!u.published} />
                    <span>{pad(u.index + 1)}</span>
                    {stillFor(u.index) && u.artifact && <span className="unit-title">{stillFor(u.index).title}</span>}
                  </button>
                </th>
                <td><Chip tone={u.execution.tone} quiet>{u.execution.label}</Chip></td>
                <td><Chip tone={u.storage.tone} quiet>{u.storage.label}</Chip></td>
                <td><Chip tone={u.recoverable ? "failed" : u.access.tone} quiet>{u.access.label}</Chip></td>
                <td className="r"><Chip tone={u.billing.tone === "authorized" ? "pending" : u.recoverable ? "ai" : u.billing.tone}>{u.billing.label}</Chip></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// The develop reveal is reserved for the moment a recovered file first appears.
const developed = new Map();
function developOnce(id) {
  if (!developed.has(id)) developed.set(id, Date.now());
  // Stay on through re-renders while it plays; never replay on a later reselect.
  return Date.now() - developed.get(id) < 3400;
}
function ArtifactCard({ unit, artifact, media, batch }) {
  const checks = [
    ["Provider completed", unit.attempt?.state === "SUCCEEDED"],
    ["Original archived", unit.artifact?.state === "STORED"],
    ["Bytes match digest", media.digest === "match"],
    ["Buyer can open it", unit.published && media.state !== "unavailable"],
  ];
  return (
    <section className="darkroom-card" aria-label={`${clipName(unit.index)} artifact`}>
      <p className="darkroom-tag">
        <FileVideoIcon size={14} aria-hidden="true" />
        {clipName(unit.index)} · {unit.restored ? "restored original" : unit.published ? "delivered" : unit.recoverable ? "exists in archive" : "no file"}
      </p>
      <div className={unit.restored && media.state === "available" && developOnce(unit.id) ? "develop" : undefined}>
        <Screening
          src={media.url}
          state={artifact ? media.state : "empty"}
          label={`${clipName(unit.index)} of ${titleOf(batch)}`}
          onRetry={media.retry}
          emptyTitle={unit.recoverable ? "Rendered and archived. Never delivered." : media.state === "unavailable" ? "The buyer route refused this file" : unit.attempt?.state === "FAILED" ? "The provider reported failure" : "No file exists for this clip"}
          emptyBody={unit.recoverable ? "Restoring it needs no new render." : media.state === "unavailable" ? media.error : "It is not billable and will not be captured."}
          caption={artifact && media.state === "available" ? "Played from the buyer route" : null}
          backdrop={unit.artifact && !artifact ? stillFor(unit.index)?.src : undefined}
        />
      </div>
      <ul className="darkroom-checks">
        {checks.map(([label, ok]) => (
          <li key={label} data-ok={ok || undefined}>{ok ? <CheckIcon size={13} weight="bold" aria-hidden="true" /> : <XIcon size={12} aria-hidden="true" />}{label}</li>
        ))}
      </ul>
      <dl className="darkroom-facts">
        <div><dt>Format</dt><dd>{artifact ? `${artifact.width || "—"}×${artifact.height || "—"} · ${artifact.duration ? `${Number(artifact.duration).toFixed(1)} s` : "—"} · ${formatBytes(artifact.bytes ?? media.bytes)}` : "—"}</dd></div>
        <div><dt>Task</dt><dd>{unit.attempt?.provider_task_id ? <Reference value={unit.attempt.provider_task_id} label="provider task" /> : "none on record"}</dd></div>
        {artifact?.sha256 && <div><dt>SHA-256</dt><dd><Reference value={artifact.sha256} label="file digest" /></dd></div>}
        {unit.restored?.receipt_hash && <div><dt>Receipt</dt><dd><Reference value={unit.restored.receipt_hash} label="buyer-route receipt" /></dd></div>}
      </dl>
    </section>
  );
}

function MoneyCard({ ctx }) {
  const { batch, units, finance, financials } = ctx;
  const fmt = (n) => money(n, batch.currency);
  const totals = paymentSummary(ctx.operations);
  const eligible = units.filter((u) => u.published).reduce((n, u) => n + u.price_minor, 0);
  const recoverable = units.filter((u) => u.recoverable).reduce((n, u) => n + u.price_minor, 0);
  const settled = finance.state === "CONFIRMED";
  return (
    <section className="sheet" aria-labelledby="money-title">
      <div className="sheet-head"><h2 id="money-title" className="eyebrow">Money on this delivery</h2></div>
      <dl className="money-rows">
        <div><dt>Agreed</dt><dd className="num">{units.length} × {fmt(units[0]?.price_minor || 0)}</dd></div>
        <div><dt>PayPal</dt><dd className="num">{financials?.unavailable ? "record unavailable" : financials?.authorization?.state === "AUTHORIZED" ? `${fmt(batch.ceiling_minor)} authorized` : "not authorized"}</dd></div>
        {settled ? (
          <>
            <div><dt>Captured</dt><dd className="num in-proof">{fmt(totals.captured)}</dd></div>
            <div><dt>Never taken</dt><dd className="num">{fmt(batch.ceiling_minor - totals.captured)}</dd></div>
          </>
        ) : (
          <>
            <div><dt>Deliverable now</dt><dd className="num">{fmt(eligible)}</dd></div>
            {recoverable > 0 && <div><dt>Recoverable</dt><dd className="num in-broken">{fmt(recoverable)} at risk</dd></div>}
          </>
        )}
        {totals.refunded > 0 && <div><dt>Refunded</dt><dd className="num">{fmt(totals.refunded)}</dd></div>}
      </dl>
    </section>
  );
}

function RecoveryPlan({ ctx, c, onRestore, canAct }) {
  const { batch, units, assessment, finance } = ctx;
  const fmt = (n) => money(n, batch.currency);
  const valid = assessment?.state === "VALID" && assessment.current !== false;
  const lost = units.filter((u) => u.recoverable);
  const restored = units.filter((u) => u.restored);
  const eligible = units.filter((u) => u.published).reduce((n, u) => n + u.price_minor, 0);
  const settled = finance.state !== "DRAFT";
  const needsRestore = lost.length > 0 || restored.length > 0;
  const steps = [
    {
      title: "Investigate the records",
      who: "auto",
      body: "AI reads provider, archive and delivery records through read-only tools and must cite what it used.",
      done: valid || settled,
      action: !valid && !settled && <button className="btn btn-proof btn-sm" disabled={!!c.busy || !canAct} onClick={() => c.investigate()}>{c.busy ? `${c.busy}…` : assessment ? "Investigate again" : "Start investigation"}<ArrowRightIcon size={13} aria-hidden="true" /></button>,
    },
    needsRestore && {
      title: lost.length ? `Re-link the original for clip ${lost.map((u) => pad(u.index + 1)).join(", ")}` : `Original re-linked for clip ${restored.map((u) => pad(u.index + 1)).join(", ")}`,
      who: "you",
      body: "The existing file, no regeneration, no new model cost.",
      done: !lost.length,
      locked: !valid && lost.length > 0,
      action: lost.length > 0 && valid && <button className="btn btn-outline btn-sm" disabled={!!c.busy} onClick={() => onRestore(lost[0])}>Review and approve</button>,
    },
    {
      title: "Verify the buyer can open it",
      who: "auto",
      body: "Confirmed only by fetching through the buyer's own route and matching the archived digest. Never by our own send.",
      done: !lost.length && units.some((u) => u.published) && (valid || settled),
      locked: lost.length > 0,
    },
    {
      title: settled ? (finance.state === "CONFIRMED" ? (finance.operation.kind === "VOID" ? "Authorization released" : `Captured ${fmt(paymentSummary(ctx.operations).captured)}`) : "Capture sent, awaiting PayPal") : eligible ? `Capture ${fmt(eligible)} against the authorization` : "Release the authorization",
      who: "you",
      body: settled ? "Read back from the payment record." : "Locked until delivery is verified. You can't charge for work the buyer hasn't received.",
      done: finance.state === "CONFIRMED",
      locked: !settled && (!valid || lost.length > 0),
      action: !settled && valid && !lost.length && <a className="btn btn-proof btn-sm" href={`#/batches/${batch.id}/settlement`}>Review settlement<ArrowRightIcon size={13} aria-hidden="true" /></a>,
    },
  ].filter(Boolean);
  return (
    <section className="sheet" aria-labelledby="plan-title">
      <div className="sheet-head plan-head">
        <p className="eyebrow">Recommended recovery</p>
        <h2 id="plan-title">{needsRestore ? "Restore, verify, then settle" : "Verify, then settle"}</h2>
      </div>
      <ol className="plan">
        {steps.map((s, i) => (
          <li key={i} data-done={s.done || undefined} data-locked={s.locked || undefined}>
            <span className="plan-mark" aria-hidden="true">{s.done ? <CheckIcon size={12} weight="bold" /> : s.locked ? <LockIcon size={12} /> : i + 1}</span>
            <div>
              <p className="plan-title">
                <strong>{s.title}</strong>
                <span className="eyebrow" data-who={s.who}>{s.who === "you" ? <><UserIcon size={11} aria-hidden="true" /> Needs you</> : <><SparkleIcon size={11} aria-hidden="true" /> Automatic</>}</span>
              </p>
              <p>{s.body}</p>
              {s.action}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Investigation({ c, ctx, data, openRestore, canAct }) {
  const [station, setStation] = useState(() => ctx.stations.find((s) => s.state === "broken")?.key || null);
  const [scoped, setScoped] = useState(false);
  const [selected, setSelected] = useState(() => (ctx.units.find((u) => u.recoverable) || ctx.units.find((u) => u.restored) || ctx.units[0]).index);
  const unit = ctx.units[selected];
  const artifact = data.artifacts.find((a) => a.unit_id === unit.id && a.published);
  const media = useArtifactMedia(artifact, data.outcomes.delivery_token);
  const active = ctx.stations.find((s) => s.key === station);
  const hypothesis = data.assessment?.assessment?.hypotheses?.[0];
  return (
    <>
      <section className="proof-block" aria-label="Proof line">
        <p className="eyebrow">Proof line · select a station</p>
        <ProofLine stations={ctx.stations} selected={station} onSelect={(k) => { setStation(k === station ? null : k); setScoped(k !== station); }} animate />
        {active && (
          <div className="station-detail sheet" data-state={active.state}>
            <div>
              <h2 className="display">{active.title}</h2>
              <p className="eyebrow">{active.subtitle}</p>
            </div>
            <div>
              <p className="eyebrow">Systems report</p>
              <p className="num">{active.value}</p>
              {active.reference && <span className="source">{String(active.reference).slice(0, 28)}</span>}
            </div>
            <div>
              <p className="eyebrow" data-state={active.state}>What this establishes</p>
              <p>{active.note}.{active.broken ? " This is where the chain broke." : ""}</p>
            </div>
          </div>
        )}
      </section>
      <div className="case-grid">
        <div className="stack">
          <Evidence ctx={ctx} station={station} scoped={scoped} setScoped={setScoped} assessment={data.assessment} />
          <ClipLedger units={ctx.units} selected={selected} onSelect={setSelected} />
        </div>
        <aside className="stack" aria-label="Artifact, money and recovery">
          <ArtifactCard unit={unit} artifact={artifact} media={media} batch={data.batch} />
          <MoneyCard ctx={ctx} />
          <RecoveryPlan ctx={ctx} c={c} onRestore={openRestore} canAct={canAct} />
          {hypothesis && (
            <a className="hypothesis-card hatch-inferred" href={`#/batches/${data.batch.id}/analysis`}>
              <SparkleIcon size={16} aria-hidden="true" />
              <span><strong>AI hypothesis · not verified</strong>{nameClips(hypothesis.description, ctx.units)}</span>
              <ArrowRightIcon size={14} aria-hidden="true" />
            </a>
          )}
        </aside>
      </div>
    </>
  );
}

/* ---------- AI analysis ---------- */
function Analysis({ c, ctx, data, openRestore, canAct }) {
  const a = data.assessment;
  const body = a?.assessment;
  const evidence = a?.evidence || [];
  const cited = new Set((body?.citations || []).map((x) => x.observation_id));
  const [focus, setFocus] = useState(null);
  const [all, setAll] = useState(false);
  const idOf = (id) => `R${evidence.findIndex((e) => e.id === id) + 1}`;
  const clipOf = (unitId) => ctx.units.find((u) => u.id === unitId);
  const done = ctx.units.filter((u) => u.attempt?.state === "SUCCEEDED").length;
  const lost = ctx.units.filter((u) => u.recoverable);
  const stale = a && a.current === false;
  const shown = all ? evidence : evidence.filter((e) => cited.has(e.id) || !e.unit_id || lost.some((u) => u.id === e.unit_id)).slice(0, 12);
  if (!a)
    return (
      <div className="sheet empty-state">
        <SparkleIcon size={22} aria-hidden="true" />
        <h2 className="display">No analysis yet.</h2>
        <p>The AI reads provider, archive and delivery records through scoped, read-only tools. It must cite what it used, and it cannot move money or publish files.</p>
        <button className="btn btn-proof" disabled={!!c.busy || !canAct} onClick={() => c.investigate()}>{c.busy ? `${c.busy}…` : "Start investigation"}</button>
      </div>
    );
  return (
    <>
      <dl className="answers">
        <div><dt className="eyebrow">Was the paid work produced?</dt><dd className="display">{done ? `${done} of ${ctx.units.length}` : "Not shown"}</dd><p>Observed: provider task status</p></div>
        <div><dt className="eyebrow">Why did delivery fail?</dt><dd className="display">{lost.length || ctx.units.some((u) => u.restored) ? "Not proven" : "It didn't"}</dd><p>{body?.hypotheses?.length ? `${body.hypotheses.length} hypothesis, unverified` : "No hypothesis offered"}</p></div>
        <div><dt className="eyebrow">Is recovery safe?</dt><dd className="display">{lost.length ? "Yes, either way" : "Nothing to recover"}</dd><p>{lost.length ? "The file exists whatever the cause" : "Every archived file is published"}</p></div>
      </dl>
      {stale && <p className="inline-banner" data-tone="pending">Records changed after this reading. It describes an earlier state. Investigate again before acting on it.</p>}
      <div className="analysis-grid">
        <section aria-labelledby="recorded-title">
          <p className="section-no"><span className="num">01</span><span className="eyebrow">What the systems recorded</span><span className="tag-observed">Observed</span></p>
          <h2 id="recorded-title" className="sr-only">Observed records</h2>
          <ol className="obs sheet">
            {shown.map((e) => (
              <li key={e.id} id={`obs-${e.id}`} data-focus={focus === e.id || undefined}>
                <span className="num obs-id">{idOf(e.id)}</span>
                <div>
                  <p>{nameClips(e.text, ctx.units)}</p>
                  <span className="source">{SOURCE_LABEL[e.source] || e.source}{e.unit_id && clipOf(e.unit_id) ? ` · clip ${pad(clipOf(e.unit_id).index + 1)}` : ""}</span>
                </div>
                {cited.has(e.id) && <span className="eyebrow cited">Cited</span>}
              </li>
            ))}
          </ol>
          {evidence.length > shown.length || all ? (
            <button className="text-link" onClick={() => setAll(!all)}>{all ? "Show the relevant records only" : `Show all ${evidence.length} records`}</button>
          ) : null}
        </section>
        <section aria-labelledby="might-title">
          <p className="section-no"><span className="num">02</span><span className="eyebrow">What it might mean</span><span className="tag-inferred">AI inference</span></p>
          <h2 id="might-title" className="sr-only">AI reading</h2>
          <div className="inference hatch-inferred">
            <p className="eyebrow">Generated by Assay. Not evidence.</p>
            <p className="inference-text">{nameClips(body?.explanation, ctx.units)}</p>
            {!!body?.citations?.length && (
              <p className="rests">
                Rests on{" "}
                {body.citations.map((x, i) => (
                  <button key={i} className="num" title={x.quote} onClick={() => { setAll(true); setFocus(x.observation_id); requestAnimationFrame(() => document.getElementById(`obs-${x.observation_id}`)?.scrollIntoView({ block: "center", behavior: scrollBehavior() })); }}>{idOf(x.observation_id)}</button>
                ))}
              </p>
            )}
            {(body?.hypotheses || []).map((h, i) => (
              <div className="hyp" key={i}>
                <p><span className="num">H{i + 1}</span><span className="eyebrow">Unverified</span></p>
                <p>{nameClips(h.description, ctx.units)}</p>
              </div>
            ))}
            <p className="inference-foot num">{PROVENANCE[a.provenance] || "Provenance not reported"} · {a.model || "model not reported"} · {stamp(a.completed_at || a.created_at, true)}</p>
          </div>
        </section>
      </div>
      <div className="analysis-grid">
        <section aria-labelledby="settle-title">
          <p className="section-no"><span className="num">03</span><span className="eyebrow">What is not established</span></p>
          <h2 id="settle-title" className="sr-only">Open questions</h2>
          <ul className="unknowns sheet hatch-muted">
            {ctx.unknowns.map((u, i) => <li key={i}>{u}</li>)}
          </ul>
        </section>
        <section aria-labelledby="proposed-title">
          <p className="section-no"><span className="num">04</span><span className="eyebrow">Proposed recovery</span></p>
          <div className="sheet proposals">
            <h2 id="proposed-title">Proposals only. Nothing was executed.</h2>
            {(body?.actions || []).map((p, i) => {
              const target = p.unit_id && clipOf(p.unit_id);
              const live = p.kind === "RESTORE_ACCESS" && target?.recoverable;
              return (
                <div className="proposal" key={i}>
                  <span className="num">{i + 1}.</span>
                  <div>
                    <strong>{p.kind === "RESTORE_ACCESS" ? `Restore buyer access${target ? ` to clip ${pad(target.index + 1)}` : ""}` : p.kind === "NO_ACTION" ? "No repair needed" : p.kind.toLowerCase().replaceAll("_", " ")}</strong>
                    <p>{nameClips(p.reason, ctx.units)}</p>
                    {live && <button className="btn btn-outline btn-sm" disabled={!!c.busy || stale} onClick={() => openRestore(target)}>Review and approve</button>}
                  </div>
                </div>
              );
            })}
            <details className="refresh-reason">
              <summary>Something changed? Request a fresh reading</summary>
              <form onSubmit={(e) => { e.preventDefault(); c.investigate(new FormData(e.currentTarget).get("reason")); }}>
                <label>What changed?<textarea name="reason" required minLength="10" maxLength="500" rows="2" /></label>
                <button className="btn btn-outline btn-sm" disabled={!!c.busy}>{c.busy ? `${c.busy}…` : "Investigate changed evidence"}</button>
              </form>
            </details>
          </div>
        </section>
      </div>
    </>
  );
}

/* The review is exact and short-lived. The bar shows how much of it is left; screen readers
   hear it at the start and near the end, not every second. */
function ExpiryLine({ expiresAt }) {
  const left = Countdown({ expiresAt });
  const [total] = useState(() => Math.max(1, left));
  // One countdown on screen. The only extra announcement is the ten-second warning.
  return (
    <div className="expiry" data-urgent={left <= 10 || undefined}>
      <p>This exact review expires in <strong className="num">{left}</strong> {left === 1 ? "second" : "seconds"}.</p>
      <span className="expiry-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (left / total) * 100)}%` }} /></span>
      <p className="expiry-warn" role="status">{left <= 10 && left > 0 ? "Approve now, or request a fresh review." : ""}</p>
    </div>
  );
}

/* ---------- Settlement ---------- */
function Settlement({ c, ctx, data, canAct, envKind }) {
  const { batch, units, finance, financials } = ctx;
  const fmt = (n) => money(n, batch.currency);
  const totals = paymentSummary(ctx.operations);
  const preview = c.preview;
  const expired = approvalExpired(preview);
  const settled = finance.state === "CONFIRMED";
  const inSet = (u) => (preview ? preview.unit_ids.includes(u.id) : u.published);
  const amount = settled ? totals.captured : preview ? preview.amount_minor : units.filter((u) => u.published).reduce((n, u) => n + u.price_minor, 0);
  const lost = units.filter((u) => u.recoverable);
  const statement = data.statement;
  const [verification, setVerification] = useState(null);
  async function verify() {
    setVerification({ state: "checking" });
    try {
      const result = await c.verifyStatement(statement.jws);
      setVerification({ state: result.valid === false ? "invalid" : "valid" });
    } catch (e) {
      setVerification({ state: "error", message: e.message });
    }
  }
  const checklist = [
    [`${units.filter((u) => u.published).length} clips published and retrievable by the buyer`, units.some((u) => u.published)],
    ["Every archived original is delivered", lost.length === 0],
    [`${units.filter((u) => !u.published).length} clips excluded from the charge`, true],
    ["Investigation is current", data.assessment?.state === "VALID" && data.assessment.current !== false],
    ["Authorization confirmed by PayPal", financials?.authorization?.state === "AUTHORIZED"],
  ];
  return (
    <div className="settle-grid">
      <div className="stack">
        <section className="sheet" aria-labelledby="units-title">
          <div className="sheet-head"><h2 id="units-title">Delivered units, reconciled against the authorization</h2></div>
          <div className="sheet-body">
            <ol className="unit-strip" aria-label="Clips in this settlement">
              {units.map((u) => (
                <li key={u.id} data-in={inSet(u) || undefined} className={inSet(u) ? undefined : "hatch-muted"} title={`${clipName(u.index)}: ${inSet(u) ? "included" : "excluded"}`}>
                  <span className="num">{pad(u.index + 1)}</span>
                  {inSet(u) ? <CheckIcon size={12} weight="bold" aria-hidden="true" /> : <XIcon size={11} aria-hidden="true" />}
                </li>
              ))}
            </ol>
            <div className="capture-scale num"><span>{fmt(0)}</span><span>Authorized ceiling {fmt(batch.ceiling_minor)}</span></div>
            <div className="capture-bar" role="img" aria-label={`${fmt(amount)} of ${fmt(batch.ceiling_minor)} ${settled ? "captured" : "to capture"}`}>
              <span className="fill num" style={{ width: `${(amount / batch.ceiling_minor) * 100}%` }}>{amount > 0 && `${fmt(amount)} ${settled ? "captured" : "to capture"}`}</span>
              <span className="rest hatch-muted num">{batch.ceiling_minor - amount > 0 && fmt(batch.ceiling_minor - amount)}</span>
            </div>
          </div>
        </section>
        <section className="sheet" aria-labelledby="terms-title">
          <div className="sheet-head terms-head">
            <p className="eyebrow">Against the agreed terms</p>
            <h2 id="terms-title">{units.length} clips · {batch.terms?.technical ? `${batch.terms.technical.min_seconds}–${batch.terms.technical.max_seconds} s · ≥ ${batch.terms.technical.min_height}p` : "technical validity"} · {fmt(units[0]?.price_minor || 0)} each · billed only when the buyer can retrieve it</h2>
          </div>
          <ol className="term-rows">
            {units.map((u) => (
              <li key={u.id}>
                <span className="num">{pad(u.index + 1)}</span>
                <span>
                  {u.restored ? "Delivery lost · original recovered · verified on the buyer route" : u.published ? "Delivered and retrievable" : u.recoverable ? "Rendered and archived, not yet delivered" : u.attempt?.state === "FAILED" ? "Provider reported failure · no file" : "No file on record"}
                </span>
                {inSet(u) ? <Chip tone="confirmed">{u.restored ? `Recovered · ${fmt(u.price_minor)}` : fmt(u.price_minor)}</Chip> : <Chip tone={u.recoverable ? "ai" : "failed"}>{u.recoverable ? "Recoverable" : "Not billable"}</Chip>}
              </li>
            ))}
          </ol>
        </section>
      </div>
      <aside className="stack">
        <section className="sheet" aria-labelledby="summary-title">
          <div className="sheet-head terms-head">
            <p className="eyebrow"><PayPalLogo size="sm" /> authorization · {envKind === "sandbox" ? "Sandbox" : envKind === "fixture" ? "test fixture" : "illustrative"}</p>
            <h2 id="summary-title" className="display">Settlement summary</h2>
          </div>
          <dl className="summary-rows">
            <div><dt>Authorized ceiling<small>What the buyer allowed, at most</small></dt><dd className="num">{fmt(batch.ceiling_minor)}</dd></div>
            <div><dt>Verified billable value<small>{units.filter(inSet).length} clips × {fmt(units[0]?.price_minor || 0)}</small></dt><dd className="num">{fmt(amount)}</dd></div>
            <div className="hl"><dt>{settled ? "Captured" : "Proposed capture"}<small>{settled ? "Confirmed by PayPal read-back" : finance.state !== "DRAFT" ? "Sent. Awaiting PayPal. Pending is not paid." : preview ? "Exact amount from the server" : "Estimate until you request the review"}</small></dt><dd className="num">{fmt(amount)}</dd></div>
            <div><dt>Uncaptured remainder<small>Never charged. Released, not refunded.</small></dt><dd className="num">{fmt(batch.ceiling_minor - amount)}</dd></div>
          </dl>
          <p className="summary-note"><strong>The {fmt(batch.ceiling_minor - amount)} is not a refund.</strong> It is never captured, so it never leaves the buyer's account.</p>
          {(financials?.authorization?.provider_id || finance.operation?.provider_id) && (
            <dl className="ref-rows">
              {financials?.authorization?.provider_id && <div><dt>Authorization</dt><dd><Reference value={financials.authorization.provider_id} label="PayPal authorization" /></dd></div>}
              {finance.operation?.provider_id && <div><dt>{finance.operation.kind === "VOID" ? "Release" : "Capture"}</dt><dd><Reference value={finance.operation.provider_id} label="PayPal capture" /></dd></div>}
            </dl>
          )}
        </section>
        <section className="sheet" aria-labelledby="approve-title">
          <div className="sheet-head"><h2 id="approve-title" className="eyebrow">{settled ? "Outcome" : "Before you approve"}</h2></div>
          <div className="sheet-body">
            {!settled && (
              <ul className="checklist">
                {checklist.map(([label, ok]) => (
                  <li key={label} data-ok={ok || undefined}>{ok ? <CheckIcon size={14} weight="bold" aria-hidden="true" /> : <WarningCircleIcon size={14} aria-hidden="true" />}{label}</li>
                ))}
              </ul>
            )}
            {c.error && <p className="inline-error" role="alert">{c.error}</p>}
            {settled ? (
              <>
                <div className="outcome" role="status">
                  <SealCheckIcon size={26} weight="fill" aria-hidden="true" />
                  <p className="display">{finance.operation.kind === "VOID" ? "Authorization released." : `${fmt(totals.captured)} captured once.`}</p>
                  <p>{finance.operation.kind === "VOID" ? "Nothing was charged." : `Confirmed by PayPal read-back. ${fmt(batch.ceiling_minor - totals.captured)} was never taken.`}</p>
                </div>
                {statement?.statement && (
                  <div className="statement">
                    <p><strong>Per-clip delivery statement</strong> <Chip tone={statement.signed ? "confirmed" : "neutral"} quiet>{statement.signed ? "Signed" : statement.illustrative ? "Unsigned example" : "Draft"}</Chip></p>
                    <p className="statement-actions">
                      {statement.signed && statement.jws && <button className="text-link" onClick={verify} disabled={verification?.state === "checking"}>{verification?.state === "checking" ? "Checking…" : "Verify signature"}</button>}
                      <button className="text-link" onClick={() => downloadJson(`delivery-statement-${batch.id.slice(0, 8)}.json`, statement)}><DownloadSimpleIcon size={14} aria-hidden="true" />Download</button>
                    </p>
                    {verification && verification.state !== "checking" && <p role="status" className={verification.state === "valid" ? "in-proof" : "in-broken"}>{verification.state === "valid" ? "Signature valid against the published key." : verification.state === "invalid" ? "Signature did not verify." : verification.message}</p>}
                  </div>
                )}
                <a className="btn btn-outline" href={`#/batches/${batch.id}/record`}>Read the resolution record</a>
              </>
            ) : finance.state !== "DRAFT" ? (
              <>
                <p className="pending-line"><SpinnerGapIcon size={16} className="spin" aria-hidden="true" />{finance.state === "UNKNOWN" ? "Sent. The outcome is unknown. Do not submit a replacement." : "Capture sent. Awaiting PayPal."}</p>
                <button className="btn btn-outline" disabled={!!c.busy} onClick={() => c.reconcile(finance.operation)}>{c.busy ? `${c.busy}…` : "Check with PayPal"}</button>
              </>
            ) : preview && !expired ? (
              <>
                <ExpiryLine expiresAt={preview.expires_at} />
                <button className="btn btn-proof btn-lg approve" disabled={!!c.busy} onClick={() => c.approveSettlement()}>
                  {c.busy ? <><SpinnerGapIcon size={16} className="spin" aria-hidden="true" />{c.busy}…</> : preview.action === "VOID" ? "Approve release" : `Approve ${fmt(preview.amount_minor)} capture`}
                </button>
              </>
            ) : (
              <>
                {preview && expired && <p className="expiry expired" role="status">That review expired. Request a fresh one.</p>}
                <button className="btn btn-proof btn-lg approve" disabled={!!c.busy || !canAct || lost.length > 0} onClick={() => c.prepareSettlement()}>
                  {c.busy ? <><SpinnerGapIcon size={16} className="spin" aria-hidden="true" />{c.busy}…</> : "Request the exact review"}
                </button>
                <p className="fine">{lost.length ? `Restore clip ${lost.map((u) => pad(u.index + 1)).join(", ")} first, or it will be left unbilled.` : "The server recalculates the amount from what the buyer can retrieve right now. AI cannot approve or change it."}</p>
                {lost.length > 0 && <button className="text-link" disabled={!!c.busy || !canAct} onClick={() => c.prepareSettlement()}>Settle without it</button>}
              </>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}

/* ---------- Resolution record ---------- */
function Record({ c, ctx, data }) {
  const { batch, units, finance } = ctx;
  const fmt = (n) => money(n, batch.currency);
  const totals = paymentSummary(ctx.operations);
  const a = data.assessment;
  const restored = units.filter((u) => u.restored);
  const ready = units.filter((u) => u.published);
  const settled = finance.state === "CONFIRMED";
  const auth = data.financials?.authorization;
  const sections = [
    ["What happened", `The buyer agreed to ${units.length} clips at ${fmt(units[0]?.price_minor || 0)} and authorized up to ${fmt(batch.ceiling_minor)} through PayPal. The provider completed ${units.filter((u) => u.attempt?.state === "SUCCEEDED").length} tasks; ${units.filter((u) => u.artifact?.state === "STORED").length} originals were archived.`, [batch.contract_hash && `contract · ${batch.contract_hash.slice(0, 12)}`, auth?.provider_id && `paypal · ${auth.provider_id}`]],
    ["What the investigation established", a?.assessment?.explanation ? nameClips(a.assessment.explanation, units) : "No investigation was run on this delivery.", (a?.assessment?.citations || []).slice(0, 3).map((x) => `cited · “${x.quote}”`), a ? "ai" : null],
    ["What was recovered", restored.length ? `The original for clip ${restored.map((u) => pad(u.index + 1)).join(", ")} was re-linked to the order. No regeneration was needed and no new model cost was incurred.` : "Nothing needed recovering in this session.", restored.map((u) => (u.restored.receipt_hash ? `receipt · ${String(u.restored.receipt_hash).slice(0, 14)}` : `artifact · ${String(u.restored.artifact_id).slice(0, 14)}`))],
    ["What the merchant approved", settled ? (finance.operation.kind === "VOID" ? "Release of the authorization. Nothing charged." : `One final capture of ${fmt(totals.captured)} against the existing authorization, approved after delivery was verified.`) : finance.state !== "DRAFT" ? "A capture was approved and sent. It is not confirmed yet." : "Nothing yet. No financial action has been approved.", finance.operation?.id ? [`approval · ${String(finance.operation.id).slice(0, 14)}`] : []],
    ["What PayPal confirmed", settled ? `${finance.operation.kind === "VOID" ? "Authorization released" : `Capture of ${fmt(totals.captured)} completed`}. ${fmt(batch.ceiling_minor - totals.captured)} was never taken. No refund was issued; none was owed.` : "Nothing yet. Pending is not paid.", finance.operation?.provider_id ? [`paypal · ${finance.operation.provider_id}`] : []],
    ["Did the customer receive it?", ready.length ? `${ready.length} of ${units.length} clips are published on the buyer's own route${data.statement?.statement ? ", each with a retrieval receipt and file digest in the delivery statement" : ""}.` : "No. Nothing is published on the buyer route.", data.statement?.signed ? ["statement · signed"] : []],
  ];
  return (
    <article className="sheet record">
      <header className="record-head">
        <p className="eyebrow">{titleOf(batch)} <StateChip ctx={ctx} /> {ctx.unknowns.length > 1 && <Chip tone="ai">{ctx.unknowns.length - 1} open {ctx.unknowns.length - 1 === 1 ? "question" : "questions"}</Chip>}</p>
        <h2 className="display">{settled ? (restored.length ? "A paid clip that looked failed was found, delivered and charged once." : `${ready.length} clips delivered and charged once.`) : "This delivery is not resolved yet."}</h2>
        <ProofLine stations={ctx.stations} />
      </header>
      <ol className="record-rows">
        {sections.map(([title, text, sources, kind], i) => (
          <li key={title}>
            <span className="num">{pad(i + 1)}</span>
            <h3>{title}{kind === "ai" && <span className="tag-inferred">AI reading</span>}</h3>
            <div>
              <p>{text}</p>
              <p className="sources">{(sources || []).filter(Boolean).map((s, n) => <span className="source" key={n}>{s}</span>)}</p>
            </div>
          </li>
        ))}
        <li className="hatch-inferred">
          <span className="num">{pad(sections.length + 1)}</span>
          <h3>What remains uncertain</h3>
          <ul className="uncertain">{ctx.unknowns.map((u, i) => <li key={i}>{u}</li>)}</ul>
        </li>
      </ol>
      <details className="record-log">
        <summary>Full event log · {ctx.timeline.length} entries</summary>
        <ol className="evidence">
          {ctx.timeline.map((e, i) => (
            <li key={i}>
              <time className="num" dateTime={e.at}>{clock(e.at)}</time>
              <div><p className="evidence-title"><strong>{e.title}</strong><span>· {e.source}</span></p>{e.reference && <span className="source">{e.reference}</span>}</div>
              {e.source === "AI" ? <span className="tag-inferred">AI</span> : <span className="tag-observed">Observed</span>}
            </li>
          ))}
        </ol>
      </details>
      <footer className="record-foot">
        <span>Recommendations by Assay · no automatic financial action taken</span>
        <button className="btn btn-outline btn-sm" onClick={() => downloadJson(`resolution-record-${batch.id.slice(0, 8)}.json`, { delivery: batch.id, stations: ctx.stations, sections: sections.map(([title, text, sources]) => ({ title, text, sources })), uncertain: ctx.unknowns, events: ctx.timeline, statement: data.statement })}><DownloadSimpleIcon size={14} aria-hidden="true" />Export record</button>
      </footer>
    </article>
  );
}

/* ---------- Route ---------- */
export function CaseWorkspace({ id, view = "", environment, envKind }) {
  const { c, data, derived } = useCaseContext(id);
  const [restoreTarget, setRestoreTarget] = useState(null);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);
  // The timeline component is large; fetch it while the investigation is being read.
  useEffect(() => {
    const t = setTimeout(() => import("./Timeline.jsx").catch(() => {}), 1200);
    return () => clearTimeout(t);
  }, []);
  // A link to a delivery this workspace does not have (an old link, another demo
  // workspace) goes to the command center with a short note, not an error screen.
  const missing = c.loadError?.status === 404;
  useEffect(() => {
    if (!missing) return;
    try {
      sessionStorage.setItem("assay-flash", "That delivery is not in this workspace, so the link was dropped. Your deliveries are listed here.");
      sessionStorage.removeItem("assay-case");
    } catch {
      /* The redirect still happens. */
    }
    window.location.hash = "/batches";
  }, [missing]);

  if (missing) return <main id="main" className="case-page" aria-busy="true"><LoadingCard label="Opening the command center…" /></main>;
  if (c.loadError)
    return (
      <main id="main" className="case-page">
        <div className="state-card" role="alert">
          <WarningCircleIcon size={24} aria-hidden="true" />
          <h1>{c.loadError.status === 404 ? "This delivery was not found." : c.loadError.status === 403 ? "You don't have access to this delivery." : c.loadError.status === 401 ? "Your session expired." : "This delivery could not be loaded."}</h1>
          <p>{c.loadError.status === 404 ? "The link may be mistyped, or the delivery belongs to another workspace. Open the command center to see the deliveries you can reach." : c.loadError.message}</p>
          <div className="state-actions">
            {c.loadError.status === 401 ? <a className="btn btn-proof" href="#/signin">Sign in</a> : <button className="btn btn-proof" onClick={c.retry}>Try again</button>}
            <a className="btn btn-outline" href="#/batches">Command center</a>
          </div>
        </div>
      </main>
    );
  if (!data || !derived)
    return (
      <main id="main" className="case-page" aria-busy="true">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-chain" />
        <div className="skeleton skeleton-block" />
        <p className="sr-only" role="status">Loading the delivery records…</p>
      </main>
    );
  const { batch } = data;
  if (["ACCEPTED", "AWAITING_BUYER_APPROVAL", "AUTHORIZING"].includes(batch.state) && data.artifacts.length === 0 && view !== "timeline")
    return <AuthorizationHandoff error={c.error} batch={batch} title={titleOf(batch)} role="operator" busy={!!c.busy} onRefresh={c.refresh} />;

  const ctx = derived;
  const canAct = !data.financials?.unavailable && ["AUTHORIZED", "RUNNING", "INVESTIGATED", "READY_FOR_REVIEW", "WAITING_FOR_AI"].includes(batch.state);
  const needsReading = !(data.assessment?.state === "VALID" && data.assessment.current !== false);
  const props = { c, ctx, data, canAct, envKind, openRestore: setRestoreTarget };
  return (
    <main id="main" className="case-page">
      <CaseHeader batch={batch} ctx={ctx} view={view} envLabel={environment}>
        <StateChip ctx={ctx} />
        {view === "" && <a className="btn btn-outline btn-sm" href={`#/batches/${batch.id}/timeline`}><ClockIcon size={14} aria-hidden="true" />Recovery window</a>}
        {view === "" && <a className="btn btn-outline btn-sm" href={`#/batches/${batch.id}/analysis`}><SparkleIcon size={14} aria-hidden="true" />AI analysis</a>}
        <button className="icon-button bordered" aria-label="Refresh records" title="Refresh records" disabled={!!c.busy} onClick={c.refresh}><ArrowClockwiseIcon size={16} /></button>
      </CaseHeader>
      {data.review?.unavailable && <p className="inline-banner" data-tone="pending">Provider and archive records are temporarily unavailable. Published files remain available to the buyer.</p>}
      {c.live && <p className="live-line" role="status"><SpinnerGapIcon size={14} className="spin" aria-hidden="true" />Clips are still archiving. This page updates itself every few seconds.</p>}
      {c.error && !restoreTarget && view !== "settlement" && (
        <p className="inline-banner" data-tone="failed" role="alert">
          <span>{c.error}</span>{" "}
          {needsReading && canAct && <button className="btn btn-outline btn-sm" disabled={!!c.busy} onClick={() => c.investigate()}>Investigate again</button>}{" "}
          <button className="text-link" onClick={() => c.setError("")}>Dismiss</button>
        </p>
      )}
      {!c.error && data.assessment?.state === "WAITING_FOR_AI" && canAct && (
        <p className="inline-banner" data-tone="pending" role="status">
          <span>The AI reading did not finish, so the evidence has no current assessment. Files, payment history and reconciliation still work.</span>{" "}
          <button className="btn btn-outline btn-sm" disabled={!!c.busy} onClick={() => c.investigate()}>{c.busy ? `${c.busy}…` : "Investigate again"}</button>
        </p>
      )}
      {view === "timeline" ? (
        <Suspense fallback={<LoadingCard label="Loading the recovery window…" note="The timeline component is about 1 MB. It is fetched once, then kept." />}>
          <Timeline batchId={batch.id} envKind={envKind} />
        </Suspense>
      ) : view === "analysis" ? <Analysis {...props} /> : view === "settlement" ? <Settlement {...props} /> : view === "record" ? <Record {...props} /> : <Investigation {...props} />}

      <div className="sr-only" role="status" aria-live="polite">{c.busy ? `${c.busy}…` : c.notice}</div>
      <Notice message={c.notice} onClose={() => c.setNotice("")} />

      {restoreTarget && (
        <Modal eyebrow={`Merchant approval · ${clipName(restoreTarget.index)}`} title={<>Give the buyer <em>the file that already exists.</em></>} onClose={() => !c.busy && setRestoreTarget(null)}>
          <p className="dialog-intro">The provider finished this clip and Assay archived it. Only the hand-off to the buyer was lost.</p>
          <ul className="dialog-facts-row">
            <li><span className="eyebrow">New render</span><strong>None</strong></li>
            <li><span className="eyebrow">Money moved</span><strong>None</strong></li>
            <li><span className="eyebrow">Who can open it</span><strong>The assigned buyer</strong></li>
          </ul>
          <p className="eyebrow dialog-label">What happens when you approve</p>
          <ol className="dialog-steps">
            <li><span className="num">01</span><div><strong>Publish the archived original</strong><p>To the assigned buyer only, on their private route.</p></div></li>
            <li><span className="num">02</span><div><strong>Fetch it the way the buyer will</strong><p>The bytes are compared with the archived SHA-256 digest.</p></div></li>
            <li><span className="num">03</span><div><strong>Read the evidence again</strong><p>Publication changes the records, so the investigation is refreshed.</p></div></li>
          </ol>
          <dl className="dialog-refs">
            <div><dt>Provider task</dt><dd className="num">{restoreTarget.attempt?.provider_task_id || "not recorded"}</dd></div>
            <div><dt>Archived file</dt><dd className="num">{restoreTarget.artifact?.id || "not recorded"}</dd></div>
          </dl>
          {c.error && <p className="inline-error" role="alert">{c.error}</p>}
          <div className="dialog-actions">
            <button className="btn btn-outline" disabled={!!c.busy} onClick={() => setRestoreTarget(null)}>Not now</button>
            <button className="btn btn-proof btn-lg" disabled={!!c.busy} onClick={async () => { const receipt = await c.restore(restoreTarget.id); if (receipt !== undefined) setRestoreTarget(null); }}>
              {c.busy ? <><SpinnerGapIcon size={16} className="spin" aria-hidden="true" />{c.busy}…</> : "Approve the restore"}
            </button>
          </div>
          <p className="dialog-foot">Capturing money is a separate approval on the Settlement page.</p>
        </Modal>
      )}
    </main>
  );
}
