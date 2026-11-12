// Loads one delivery and exposes the operator/buyer actions. Money authority stays
// on the server: previews are validated here only so a stale review cannot be shown.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { contentBlob, request } from "../api.js";
import { approvalExpired, financialState, validatePreview } from "../domain.js";
import { recoveryReceipts, sha256Hex } from "./model.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const HARD = [401, 403, 404];
// Records that are still moving. While any is present the page rereads itself.
const MOVING_FILE = ["COPYING", "PENDING", "VALIDATING", "QUEUED", "RESERVED"];
// Provider status strings are copied as the provider sends them (Replicate's are lowercase).
const MOVING_TASK = ["RUNNING", "PENDING", "SUBMITTED", "QUEUED", "PROCESSING", "REGISTERED", "RESERVED", "DISPATCHING", "THROTTLED", "STARTING"];
const upper = (v) => String(v || "").toUpperCase();
const BEFORE_HOLD = ["ACCEPTED", "AWAITING_BUYER_APPROVAL", "AUTHORIZING"];

/** True while a provider task is running or a finished task's file is not archived yet. */
export function stillArchiving(data) {
  if (!data || data.batch?.state === "CLOSED") return false;
  const files = [...(data.artifacts || []), ...(data.review?.artifacts || [])];
  if (files.some((a) => MOVING_FILE.includes(upper(a.state)))) return true;
  const attempts = data.review?.attempts || [];
  // UNKNOWN is deliberately not "moving": it stays unknown until evidence resolves it.
  if (attempts.some((a) => MOVING_TASK.includes(upper(a.state)))) return true;
  const stored = new Set(files.map((a) => a.unit_id));
  return attempts.some((a) => upper(a.state) === "SUCCEEDED" && !stored.has(a.unit_id));
}

export function useCase(id, role = "operator") {
  const root = `/v1/batches/${encodeURIComponent(id)}`;
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(null);
  const [pending, setPending] = useState(null);
  // Which clips were restored comes from the batch record. The receipt returned by a
  // restore in this visit only adds its detail (hash, checker) and is never stored.
  const [fresh, setFresh] = useState([]);
  const receipts = useMemo(() => recoveryReceipts(data?.batch, fresh), [data?.batch, fresh]);
  const approveIntent = useRef(null);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  // Set once the service has said there is no investigation yet, so later reads of an
  // uninvestigated delivery do not ask again (and log a 404) on every refresh.
  const noInvestigation = useRef(false);

  const load = useCallback(async () => {
    const [batch, outcomes, review] = await Promise.all([
      request(root, { role }),
      request(root + "/outcomes", { role }),
      role === "operator"
        ? request(root + "/review").catch((e) => {
            if (HARD.includes(e.status)) throw e;
            return { attempts: [], artifacts: [], unavailable: true };
          })
        : Promise.resolve(null),
    ]);
    if (!Array.isArray(batch.units) || !Array.isArray(outcomes.artifacts))
      throw new Error("The service returned an incomplete delivery. Try refreshing.");
    const optional = (path, fallback) =>
      request(root + path, { role }).catch((e) => {
        if ([401, 403].includes(e.status)) throw e;
        return typeof fallback === "function" ? fallback(e) : fallback;
      });
    const operations0 = outcomes.operations || [];
    // A statement exists only once a capture or release has been requested; an
    // investigation only after the hold. Asking earlier is a guaranteed 404.
    const mayHaveStatement =
      ["CLOSED", "SETTLEMENT_REQUESTED", "CLAIMED"].includes(batch.state) ||
      operations0.some((o) => ["CAPTURE", "VOID"].includes(o.kind));
    const mayHaveInvestigation =
      !BEFORE_HOLD.includes(batch.state) &&
      !(noInvestigation.current && ["AUTHORIZED", "RUNNING"].includes(batch.state));
    const [financials, activity, statement, assessment, status] =
      await Promise.all([
        optional("/financials", { unavailable: true }),
        optional("/activity", { events: [] }),
        mayHaveStatement ? optional("/statement", null) : null,
        role === "operator" && mayHaveInvestigation
          ? optional("/investigation", (e) =>
              e.status === 404
                ? ((noInvestigation.current = true), null)
                : {
                    state: "WAITING_FOR_AI",
                    unavailable: true,
                    assessment: {
                      explanation:
                        "Investigation history is temporarily unavailable. Files and payment reconciliation remain accessible.",
                    },
                  },
            )
          : null,
        ["SETTLEMENT_REQUESTED", "CLAIMED"].includes(batch.state)
          ? optional("/settlement-status", null)
          : null,
      ]);
    const operations = outcomes.operations || [];
    const next = {
      batch,
      outcomes,
      artifacts: outcomes.artifacts,
      operations,
      review,
      financials,
      activity: activity?.events || [],
      statement,
      assessment,
      paymentStatusUnavailable: !!outcomes.payment_status_unavailable,
    };
    if (mounted.current) {
      setData(next);
      setLoadError(null);
      if (
        status?.proposal &&
        !operations.some((o) => ["CAPTURE", "VOID"].includes(o.kind))
      )
        setPending({
          state: "PENDING",
          title: "Settlement processing",
          operation: {
            id: status.proposal.id,
            kind: status.proposal.action,
            amount_minor: status.proposal.amount_minor,
            state: "PENDING",
          },
        });
      else if (operations.some((o) => ["CAPTURE", "VOID"].includes(o.kind)))
        setPending(null);
    }
    return next;
  }, [root, role]);

  useEffect(() => {
    mounted.current = true;
    setData(null);
    setLoadError(null);
    setFresh([]);
    load().catch((e) => mounted.current && setLoadError(e));
    return () => {
      mounted.current = false;
    };
  }, [load, id]);

  // While clips are still archiving, reread the delivery every three seconds. Only the
  // batch, its outcomes and the provider review are read; nothing is written.
  const moving = stillArchiving(data);
  const runningAssessment = ["RESERVED", "RUNNING"].includes(data?.assessment?.state);
  useEffect(() => {
    if (!moving && !runningAssessment) return;
    let ticks = 0;
    const timer = setInterval(async () => {
      if (busyRef.current || document.hidden) return;
      if (++ticks > 100) return clearInterval(timer);
      try {
        if (runningAssessment) return void (await load());
        const [batch, outcomes, review] = await Promise.all([
          request(root, { role }),
          request(root + "/outcomes", { role }),
          role === "operator" ? request(root + "/review").catch(() => null) : null,
        ]);
        if (!mounted.current || !Array.isArray(outcomes.artifacts)) return;
        let settled = false;
        setData((d) => {
          if (!d) return d;
          const next = { ...d, batch, outcomes, artifacts: outcomes.artifacts, operations: outcomes.operations || [], review: review || d.review };
          settled = !stillArchiving(next);
          return next;
        });
        // One full read once everything has landed, to pick up what followed from it.
        if (settled) load().catch(() => {});
      } catch {
        /* A missed poll is harmless; the next one tries again. */
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [moving, runningAssessment, load, root, role]);

  async function act(name, fn) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(name);
    setError("");
    try {
      return await fn();
    } catch (e) {
      if (mounted.current)
        setError(e.message || "The request could not be completed. Your work is preserved.");
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy("");
    }
  }

  async function runInvestigation(refreshReason) {
    noInvestigation.current = false;
    let result = await request(root + "/investigate", {
      body: refreshReason ? { refresh_reason: refreshReason } : {},
      intent: `investigate:${id}:${crypto.randomUUID()}`,
    });
    for (let i = 0; i < 80 && ["RESERVED", "RUNNING"].includes(result.state); i++) {
      if (!mounted.current) throw new Error("Review was closed.");
      await wait(750);
      result = await request(root + "/investigation");
    }
    if (result.state !== "VALID") {
      await load().catch(() => {});
      throw new Error(
        ["RESERVED", "RUNNING"].includes(result.state)
          ? "The investigation is still running. Refresh to see its result; files and payment history remain available."
          : result.state === "WAITING_FOR_AI"
            ? "AI is unavailable. Files and payment reconciliation remain accessible."
            : "The investigation was not conclusive. A current, valid assessment is required before normal settlement.",
      );
    }
    await request(root + "/investigate", {
      body: {},
      intent: `adopt:${id}:${result.id}:${crypto.randomUUID()}`,
    });
    return result;
  }

  const investigate = (reason) =>
    act(reason ? "Reviewing changed evidence" : "Investigating evidence", async () => {
      await runInvestigation(reason);
      await load();
      setNotice("Investigation complete. Findings cite the records they used.");
      return true;
    });

  const restore = (unitId) =>
    act("Restoring the original file", async () => {
      const current = data?.assessment;
      const result =
        current?.state === "VALID" && current.current !== false
          ? current
          : await runInvestigation();
      const latest = await request(root + "/review");
      const candidate = latest.artifacts.find(
        (a) => !a.published && (!unitId || a.unit_id === unitId),
      );
      if (!candidate) {
        await load();
        setNotice("No archived, unpublished file needs restoring.");
        return null;
      }
      const receipt = await request(root + "/recover", {
        body: { artifact_id: candidate.id, assessment_id: result.id },
        intent: `recover:${candidate.id}:${result.id}`,
      });
      const kept = {
        unit_id: receipt.unit_id || candidate.unit_id,
        artifact_id: receipt.artifact_id || candidate.id,
        outcome: receipt.outcome,
        checker_version: receipt.checker_version,
        receipt_hash: receipt.receipt_hash,
        sha256: receipt.sha256,
        observed_at: receipt.observed_at || new Date().toISOString(),
      };
      setFresh((all) => [...all.filter((r) => r.unit_id !== kept.unit_id), kept]);
      await runInvestigation(
        "Refresh after restoring purchaser access to the original archived output.",
      );
      await load();
      setNotice("Original restored without a new render. Evidence was reassessed.");
      return kept;
    });

  const prepareSettlement = () =>
    act("Preparing the exact review", async () => {
      const current = data?.assessment;
      if (!(current?.state === "VALID" && current.current !== false))
        await runInvestigation();
      const next = await request(root + "/closure-preview", {
        body: {},
        intent: `preview:${id}:${crypto.randomUUID()}`,
      });
      validatePreview(next, data.batch);
      approveIntent.current = `approve:${next.id}`;
      setPreview(next);
      return next;
    });

  const approveSettlement = () =>
    act("Submitting your approval", async () => {
      if (approvalExpired(preview))
        throw new Error("This review expired. Request a fresh review before confirming.");
      try {
        await request(root + "/approve", {
          body: { proposal_id: preview.id, approval_digest: preview.approval_digest },
          intent: approveIntent.current,
        });
      } catch (e) {
        if (!e.status || e.status >= 500) {
          setPending({
            state: "UNKNOWN",
            title: "Awaiting confirmation",
            operation: {
              id: preview.id,
              kind: preview.action,
              state: "UNKNOWN",
              amount_minor: preview.amount_minor,
            },
          });
          setPreview(null);
        }
        throw e;
      }
      let settled = false;
      for (let i = 0; i < 10 && !settled; i++) {
        await wait(650);
        const next = await load();
        settled = next.operations.some((o) => ["CAPTURE", "VOID"].includes(o.kind));
      }
      if (!settled)
        setPending({
          state: "PENDING",
          title: "Settlement processing",
          operation: {
            id: preview.id,
            kind: preview.action,
            state: "PENDING",
            amount_minor: preview.amount_minor,
          },
        });
      setPreview(null);
      setNotice("Approval submitted. The status shown comes from the payment record.");
      return true;
    });

  const reconcile = (operation) =>
    act("Checking the payment record", async () => {
      if (operation?.id && role === "operator")
        await request(`/v1/operations/${operation.id}/reconcile`, {
          body: {},
          intent: `reconcile:${operation.id}:${crypto.randomUUID()}`,
        }).catch((e) => {
          if (e.status !== 404) throw e;
        });
      await load();
      setNotice("Payment record refreshed.");
    });

  const refresh = () =>
    act("Refreshing records", async () => {
      await load();
      setNotice("Records refreshed.");
    });

  const verifyStatement = (jws) => request("/v1/statements/verify", { role, body: { jws } });

  const server = financialState(data?.operations || []);
  const finance = pending && server.state === "DRAFT" ? pending : server;

  return {
    id,
    role,
    data,
    loadError,
    busy,
    live: moving || runningAssessment,
    error,
    setError,
    notice,
    setNotice,
    preview,
    setPreview,
    finance,
    receipts,
    investigate,
    restore,
    prepareSettlement,
    approveSettlement,
    reconcile,
    refresh,
    verifyStatement,
    retry: () => load().catch((e) => setLoadError(e)),
  };
}

/** Fetches one published file through the buyer delivery route and checks its digest. */
export function useArtifactMedia(artifact, deliveryToken) {
  const [media, setMedia] = useState({ state: "idle", url: "", digest: null, error: "" });
  // Tokens rotate on every refresh; refetch only when the file itself changes.
  const token = useRef(deliveryToken);
  token.current = deliveryToken;
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const deliveryToken = token.current;
    const abort = new AbortController();
    let url;
    if (!artifact?.content_path || !deliveryToken) {
      setMedia({ state: "idle", url: "", digest: null, error: "" });
      return;
    }
    setMedia({ state: "loading", url: "", digest: null, error: "" });
    contentBlob(artifact, deliveryToken, abort.signal)
      .then(async (blob) => {
        url = URL.createObjectURL(blob);
        const actual = await sha256Hex(blob).catch(() => null);
        if (abort.signal.aborted) return;
        setMedia({
          state: "available",
          url,
          bytes: blob.size,
          digest: !actual || !artifact.sha256 ? "unchecked" : actual === artifact.sha256 ? "match" : "mismatch",
          actual,
          error: "",
        });
      })
      .catch((e) => {
        if (e.name === "AbortError" || abort.signal.aborted) return;
        setMedia({ state: "unavailable", url: "", digest: null, error: e.message });
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [artifact?.id, artifact?.content_path, !!deliveryToken, attempt]);
  return { ...media, retry: () => setAttempt((n) => n + 1) };
}
