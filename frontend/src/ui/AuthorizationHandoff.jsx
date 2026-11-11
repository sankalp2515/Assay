import { useState } from "react";
import {
  CheckCircleIcon,
  CreditCardIcon,
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
} from "@phosphor-icons/react";
import { money } from "../domain.js";

export function AuthorizationHandoff({
  batch,
  title,
  role,
  busy,
  onRefresh,
  error,
}) {
  const [feedback, setFeedback] = useState("");
  const [copyError, setCopyError] = useState("");
  const buyerPath = `#/buyer/${batch.id}/agreement`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}${location.pathname}${buyerPath}`,
      );
      setFeedback(
        "Agreement link copied. Only the assigned buyer can consent.",
      );
      setCopyError("");
    } catch {
      setCopyError(
        "The link could not be copied. Open the buyer agreement and copy its address.",
      );
    }
  }
  return (
    <main id="main" className="flow-page">
      <div className="flow-heading">
        <div>
          <h1>{title}</h1>
          <p>
            {role === "buyer"
              ? "Review the agreement before authorizing its payment ceiling."
              : "Your agreement is ready. The next step belongs to the buyer."}
          </p>
        </div>
        <a
          className="secondary flow-button"
          href={role === "buyer" ? buyerPath : "#/batches"}
        >
          {role === "buyer" ? "Review agreement" : "Back to deliveries"}
        </a>
      </div>
      <div className="handoff-layout">
        <section className="handoff-main" aria-labelledby="handoff-title">
          <div className="handoff-state">
            <CheckCircleIcon size={20} aria-hidden="true" />
            <span>Agreement created</span>
          </div>
          <h2 id="handoff-title">
            {batch.state === "AUTHORIZING"
              ? "Checking buyer authorization"
              : "Waiting for buyer authorization"}
          </h2>
          <p>
            {role === "buyer"
              ? "The authorization sets a maximum hold. The final charge depends on eligible delivery under this agreement."
              : "Share the private agreement link with your buyer. They can review the deliverables, fixed terms and maximum PayPal authorization before consenting."}
          </p>
          <div className="handoff-mobile-ceiling">
            <span>Maximum PayPal authorization</span>
            <strong>{money(batch.ceiling_minor)}</strong>
            <span>Not a confirmed charge</span>
          </div>
          <div className="handoff-actions">
            {role === "buyer" ? (
              <a className="primary flow-button" href={buyerPath}>
                Review agreement & PayPal
              </a>
            ) : (
              <>
                <button className="primary" onClick={copy}>
                  Copy buyer agreement link
                </button>
                <a className="secondary flow-button" href={buyerPath}>
                  Preview buyer agreement
                  <ArrowSquareOutIcon size={16} aria-hidden="true" />
                </a>
              </>
            )}
          </div>
          {feedback && (
            <p className="handoff-feedback" role="status">
              {feedback}
            </p>
          )}
          {copyError && (
            <p className="inline-error" role="alert">
              {copyError}
            </p>
          )}
          <ol className="handoff-progress">
            <li data-state="done">
              <span className="handoff-step-mark">
                <CheckCircleIcon size={18} aria-hidden="true" />
              </span>
              <div>
                <h3>Agreement created</h3>
                <p>The buyer, deliverables and unit prices are fixed.</p>
              </div>
            </li>
            <li data-state="current">
              <span className="handoff-step-mark">2</span>
              <div>
                <h3>Buyer authorizes PayPal</h3>
                <p>
                  Authorization is not yet confirmed in this delivery record.
                </p>
              </div>
            </li>
            <li>
              <span className="handoff-step-mark">3</span>
              <div>
                <h3>Recover, verify and settle</h3>
                <p>
                  {role === "buyer"
                    ? "The merchant recovers original files, verifies access and reviews eligible settlement."
                    : "Attach existing jobs, review AI findings and approve the exact eligible amount."}
                </p>
              </div>
            </li>
          </ol>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button className="text-link" disabled={busy} onClick={onRefresh}>
            <ArrowClockwiseIcon size={17} aria-hidden="true" />
            {busy ? "Checking authorization..." : "Check authorization status"}
          </button>
        </section>
        <aside className="handoff-agreement" aria-label="Fixed agreement">
          <div className="agreement-preview-header">
            <CreditCardIcon size={20} aria-hidden="true" />
            <h2>Fixed agreement</h2>
          </div>
          <div className="preview-total">
            <span>Maximum authorization</span>
            <strong>{money(batch.ceiling_minor)}</strong>
            <span>USD - not a confirmed charge</span>
          </div>
          <dl className="settings-facts">
            <div>
              <dt>Deliverables</dt>
              <dd>
                {batch.units.length}{" "}
                {batch.units.length === 1 ? "clip" : "clips"}
              </dd>
            </div>
            <div>
              <dt>Price per clip</dt>
              <dd>{money(batch.units[0]?.price_minor || 0)}</dd>
            </div>
            <div>
              <dt>Agreement reference</dt>
              <dd>
                <code>{batch.id.slice(0, 8)}</code>
              </dd>
            </div>
          </dl>
          <div className="handoff-brief">
            <h3>Technical deliverables</h3>
            <p>
              H.264 video, at least 720px high, 4-10 seconds, up to 25 MiB per
              clip. Creative satisfaction is handled separately.
            </p>
          </div>
          <a className="text-link" href={`#/payments/${batch.id}`}>
            View payment record
            <ArrowSquareOutIcon size={16} aria-hidden="true" />
          </a>
          <p className="preview-source-note">
            Files are retrievable before capture. Unused authorization is not a
            refund.
          </p>
        </aside>
      </div>
    </main>
  );
}
