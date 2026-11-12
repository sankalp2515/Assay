// What the customer sees: their clips first, then exactly what was and was not charged.
import { useEffect, useMemo, useState } from "react";
import { ArrowClockwiseIcon, CheckIcon, DownloadSimpleIcon, PlayIcon, SealCheckIcon, VideoCameraSlashIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { money, paymentSummary } from "../domain.js";
import { Notice } from "../ui/Notice.jsx";
import { AuthorizationHandoff } from "../ui/AuthorizationHandoff.jsx";
import { Chip, Reference, Screening, formatBytes, scrollBehavior, stamp } from "../ui/kit.jsx";
import { buildUnits, clipName } from "../case/model.js";
import { useArtifactMedia, useCase } from "../case/useCase.js";
import { titleOf } from "../case/CaseWorkspace.jsx";
import { stillFor } from "../ui/stills.jsx";
import "../case/case.css";
import "./buyer.css";
import { PayPalLogo } from "../ui/PayPalLogo.jsx";

const pad = (n) => String(n).padStart(2, "0");

export function BuyerDelivery({ id }) {
  const c = useCase(id, "buyer");
  const [selected, setSelected] = useState(null);
  const data = c.data;
  const units = useMemo(() => (data ? buildUnits({ ...data, review: null, receipts: c.receipts || [], statement: data.statement?.statement }) : null), [data, c.receipts]);
  useEffect(() => {
    if (units && selected === null) setSelected(units.find((u) => u.published)?.index ?? 0);
  }, [units, selected]);
  const unit = units?.[selected ?? 0];
  const artifact = data?.artifacts.find((a) => a.unit_id === unit?.id && a.published);
  const media = useArtifactMedia(artifact, data?.outcomes.delivery_token);

  if (c.loadError)
    return (
      <main id="main" className="buyer-page">
        <div className="state-card" role="alert">
          <WarningCircleIcon size={24} aria-hidden="true" />
          <h1>{c.loadError.status === 401 ? "Sign in to open your delivery." : [403, 404].includes(c.loadError.status) ? "This delivery isn't available to you." : "Your delivery could not be loaded."}</h1>
          <p>{[403, 404].includes(c.loadError.status) ? "Open the private link your studio sent you. Deliveries are visible only to their assigned buyer." : c.loadError.message}</p>
          <div className="state-actions">{c.loadError.status === 401 ? <a className="btn btn-proof" href="#/signin">Sign in</a> : <button className="btn btn-proof" onClick={c.retry}>Try again</button>}</div>
        </div>
      </main>
    );
  if (!data || !units || !unit)
    return (
      <main id="main" className="buyer-page" aria-busy="true">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-block" />
        <p className="sr-only" role="status">Loading your delivery…</p>
      </main>
    );

  const { batch, financials, operations, statement } = data;
  if (["ACCEPTED", "AWAITING_BUYER_APPROVAL", "AUTHORIZING"].includes(batch.state) && data.artifacts.length === 0)
    return <AuthorizationHandoff error={c.error} batch={batch} title={titleOf(batch)} role="buyer" busy={!!c.busy} onRefresh={c.refresh} />;

  const fmt = (n) => money(n, batch.currency);
  const finance = c.finance;
  const totals = paymentSummary(operations);
  const ready = units.filter((u) => u.published);
  const estimate = ready.reduce((n, u) => n + u.price_minor, 0);
  const settled = finance.state === "CONFIRMED";
  const voided = settled && finance.operation.kind === "VOID";
  const authorized = financials?.authorization?.state === "AUTHORIZED";
  const missing = units.filter((u) => !u.published);
  const steps = [
    ["Terms agreed", `${units.length} clips · ${fmt(units[0]?.price_minor || 0)} each`, true],
    ["PayPal authorized", authorized ? `Up to ${fmt(batch.ceiling_minor)}` : "Not confirmed", authorized],
    ["Delivered", `${ready.length} of ${units.length} ready`, ready.length > 0],
    ["Settled", settled ? (voided ? "Nothing charged" : `${fmt(totals.captured)} charged`) : finance.state === "DRAFT" ? "Not charged yet" : "Being confirmed", settled],
  ];
  function download() {
    if (!media.url) return;
    const a = document.createElement("a");
    a.href = media.url;
    a.download = `${titleOf(batch).replace(/[^\w-]+/g, "-").toLowerCase()}-clip-${pad(unit.index + 1)}.mp4`;
    document.body.append(a);
    a.click();
    a.remove();
    c.setNotice("Download started.");
  }
  function downloadStatement() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(statement, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `delivery-statement-${batch.id.slice(0, 8)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <main id="main" className="buyer-page">
      <header className="buyer-hero enter">
        <div>
          <p className="eyebrow">{titleOf(batch)} · {units.length} clips · kept until {stamp(batch.retention_until)}</p>
          <h1>
            {settled ? (voided ? <>Nothing was delivered. <em>Nothing was charged.</em></> : <>Your delivery <em>is ready.</em></>) : ready.length ? <>{ready.length} of {units.length} clips <em>are ready.</em></> : <>Your clips are <em>on their way.</em></>}
          </h1>
        </div>
        <p className="buyer-lead">
          {settled && !voided ? (
            <><strong>{ready.length} of {units.length} clips were delivered.</strong> You're charged for those: {fmt(totals.captured)} of the {fmt(batch.ceiling_minor)} you authorized. The other {fmt(batch.ceiling_minor - totals.captured)} was never taken.</>
          ) : settled ? (
            <>No clip met the delivery terms, so your {fmt(batch.ceiling_minor)} hold was released.</>
          ) : (
            <><strong>You can open ready clips now.</strong> PayPal is holding up to {fmt(batch.ceiling_minor)}. Nothing is charged until the studio settles, and only for clips you can open.</>
          )}
        </p>
      </header>

      <ol className="buyer-steps sheet" aria-label="Where your order stands">
        {steps.map(([label, detail, done], i) => (
          <li key={label} data-done={done || undefined}>
            <span className="step-mark" aria-hidden="true">{done ? <CheckIcon size={12} weight="bold" /> : null}</span>
            <span className="num">{pad(i + 1)}</span>
            <strong>{label}</strong>
            <span className="num detail">{detail}</span>
          </li>
        ))}
      </ol>

      {c.error && <p className="inline-banner" data-tone="failed" role="alert">{c.error}</p>}

      <div className="buyer-grid">
        <section aria-labelledby="clips-heading">
          <div className="clips-head">
            <h2 id="clips-heading" className="display">Your clips</h2>
            <button className="icon-button bordered" aria-label="Refresh delivery" title="Refresh delivery" disabled={!!c.busy} onClick={c.refresh}><ArrowClockwiseIcon size={16} /></button>
          </div>
          <div className="darkroom-card buyer-player">
            <Screening
              src={media.url}
              state={artifact ? media.state : "empty"}
              label={`${clipName(unit.index)} of ${titleOf(batch)}`}
              onRetry={media.retry}
              emptyTitle={media.state === "unavailable" ? "This clip can't be opened right now" : `${clipName(unit.index)} was not delivered`}
              emptyBody={media.state === "unavailable" ? `${media.error} You are not charged for clips you cannot open.` : settled ? "You were not charged for it." : "You will only be charged for clips you can open."}
            />
            <div className="player-bar">
              <div>
                <strong>{clipName(unit.index)}</strong>
                <span className="num">{artifact ? `${artifact.width || "—"}×${artifact.height || "—"} · ${artifact.duration ? `${Number(artifact.duration).toFixed(0)} s` : "—"} · ${formatBytes(artifact.bytes ?? media.bytes)}` : "no file"}</span>
              </div>
              {artifact && media.digest === "match" && <span className="intact"><CheckIcon size={13} weight="bold" aria-hidden="true" />File verified intact</span>}
              <button className="btn btn-sm player-download" disabled={media.state !== "available"} onClick={download}><DownloadSimpleIcon size={14} aria-hidden="true" />Download</button>
            </div>
          </div>
          <ul className="clip-grid" aria-label="Clips in this delivery">
            {units.map((u) => (
              <li key={u.id}>
                <button className="clip-card" aria-pressed={selected === u.index} data-ready={u.published || undefined} aria-label={`${clipName(u.index)}: ${u.published ? "ready" : "not delivered"}`} onClick={() => { setSelected(u.index); window.scrollTo({ top: document.querySelector(".buyer-player")?.offsetTop - 80, behavior: scrollBehavior() }); }}>
                  <span className={`clip-thumb${u.published ? "" : " hatch-muted"}`}>
                    {u.published && stillFor(u.index) && <img src={stillFor(u.index).src} alt="" loading="lazy" decoding="async" />}
                    <span className="num">{pad(u.index + 1)}</span>
                    {u.restored && <span className="clip-badge">Recovered</span>}
                    {u.published ? <PlayIcon size={18} weight="fill" aria-hidden="true" /> : <VideoCameraSlashIcon size={18} aria-hidden="true" />}
                  </span>
                  <span className="clip-meta">
                    <strong>{(u.published && stillFor(u.index)?.title) || clipName(u.index)}</strong>
                    <span>{u.restored ? "Restored original · ready to open" : u.published ? "Ready to open" : settled ? "Not delivered · not charged" : "Not delivered"}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <aside className="stack">
          <section className="sheet receipt" aria-labelledby="payment-heading">
            <div className="receipt-top">
              <p className="eyebrow" id="payment-heading">Receipt · <PayPalLogo size="sm" /></p>
              <p className="display receipt-amount">{fmt(settled ? totals.captured : finance.state === "DRAFT" ? 0 : finance.operation?.amount_minor || 0)}</p>
              <p>{settled ? (voided ? "nothing was charged" : `charged for ${units.filter((u) => u.billing.tone === "confirmed").length} delivered clips`) : finance.state === "DRAFT" ? "charged so far. A hold is not a charge." : "requested. Not confirmed by PayPal yet."}</p>
            </div>
            <dl className="money-rows">
              <div><dt>You authorized up to</dt><dd className="num">{fmt(batch.ceiling_minor)}</dd></div>
              {!settled && finance.state === "DRAFT" && <div><dt>If settled now</dt><dd className="num">{fmt(estimate)} <span className="est">estimate</span></dd></div>}
              {settled && <div><dt>Charged</dt><dd className="num">{fmt(totals.captured)}</dd></div>}
              {settled && <div><dt>Never charged</dt><dd className="num">{fmt(batch.ceiling_minor - totals.captured)}</dd></div>}
              {(totals.refunded > 0 || totals.pendingRefund > 0) && <div><dt>Refunded to you</dt><dd className="num">{fmt(totals.refunded)}{totals.pendingRefund ? ` · ${fmt(totals.pendingRefund)} pending` : ""}</dd></div>}
              <div><dt>Status</dt><dd><Chip tone={settled ? "confirmed" : finance.state === "DRAFT" ? "pending" : finance.state === "UNKNOWN" ? "unknown" : "pending"}>{settled ? "Confirmed by PayPal" : finance.state === "DRAFT" ? "On hold, not charged" : "Awaiting PayPal"}</Chip></dd></div>
              {settled && finance.operation?.provider_id && <div><dt>Reference</dt><dd><Reference value={finance.operation.provider_id} label="PayPal reference" /></dd></div>}
            </dl>
            {settled && <p className="summary-note">The {fmt(batch.ceiling_minor - totals.captured)} isn't a refund. It was released without ever leaving your account.</p>}
          </section>

          {statement?.statement && (
            <section className="sheet" aria-labelledby="statement-heading">
              <div className="sheet-head">
                <h2 id="statement-heading"><SealCheckIcon size={16} aria-hidden="true" /> Per-clip statement</h2>
                <Chip tone={statement.signed ? "confirmed" : "neutral"} quiet>{statement.signed ? "Signed" : statement.illustrative ? "Unsigned example" : "Draft"}</Chip>
              </div>
              <ol className="term-rows">
                {statement.statement.clips.map((line) => (
                  <li key={line.clip}><span className="num">{pad(line.clip)}</span><span>{line.charged ? "Delivered" : "Not delivered"}</span><span className="num">{line.charged ? fmt(line.price_minor) : "not charged"}</span></li>
                ))}
              </ol>
              <div className="sheet-body"><button className="text-link" onClick={downloadStatement}><DownloadSimpleIcon size={14} aria-hidden="true" />Download statement</button></div>
            </section>
          )}

          {missing.length > 0 && (
            <section className="sheet missing" aria-labelledby="missing-heading">
              <p className="eyebrow" id="missing-heading">For clip {missing.map((u) => pad(u.index + 1)).join(" and ")}</p>
              <p className="display">{settled ? "They weren't delivered, so you weren't charged." : "Not delivered yet. You won't be charged unless they arrive."}</p>
              <a className="btn btn-outline btn-sm" href={`#/support/${batch.id}`}>Tell the studio</a>
            </section>
          )}

          <details className="sheet agreed">
            <summary>What you agreed to</summary>
            <ul>
              <li>{fmt(units[0]?.price_minor || 0)} for each clip that is technically valid and that you can retrieve.</li>
              <li>Ready clips are yours to open before the final charge.</li>
              <li>Clips that are never delivered are never charged.</li>
              <li>Creative taste is outside the technical check. Tell the studio if a clip misses your brief.</li>
            </ul>
            <p><a href={`#/buyer/${batch.id}/agreement`}>Read the agreement</a> · <a href={`#/payments/${batch.id}`}>Payment history</a></p>
          </details>
        </aside>
      </div>
      <div className="sr-only" role="status" aria-live="polite">{c.busy ? `${c.busy}…` : c.notice}</div>
      <Notice message={c.notice} onClose={() => c.setNotice("")} />
    </main>
  );
}
