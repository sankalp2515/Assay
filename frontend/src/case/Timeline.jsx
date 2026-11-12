// Recovery window: every clip's provider copy, Assay's archived copy and the PayPal hold on
// one clock. Drawn with Bryntum Scheduler; the data is the service's timeline, unchanged.
import { useEffect, useMemo, useRef, useState } from "react";
import "./bryntum-license.js";
import "@bryntum/scheduler-enterprise";
import { BryntumScheduler } from "@bryntum/scheduler-react-enterprise";
import "@bryntum/scheduler-enterprise/scheduler.css";
import "@bryntum/scheduler-enterprise/svalbard-light.css";
import "./timeline.css";
import { request } from "../api.js";
import { stamp } from "../ui/kit.jsx";
import { buildSchedule, describe, eventClass } from "./timeline-model.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export default function Timeline({ batchId, envKind }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState("race");
  const [tick, setTick] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    let live = true;
    setError(null);
    request(`/v1/batches/${encodeURIComponent(batchId)}/timeline`)
      .then((v) => live && setView(v))
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [batchId, envKind, tick]);

  const model = useMemo(() => (view ? buildSchedule(view) : null), [view]);
  const range = model?.[mode];
  const config = useMemo(() => {
    if (!model) return null;
    return {
      resources: model.resources,
      events: model.events.map((e) => ({
        id: e.id,
        resourceId: e.resourceId,
        name: e.name,
        startDate: new Date(e.start),
        endDate: new Date(e.end),
        cls: eventClass(e),
        basis: e.basis,
        note: e.note,
        sentence: describe(e),
        point: e.point,
      })),
    };
  }, [model]);

  useEffect(() => {
    const s = ref.current?.instance;
    if (!s || !range) return;
    s.zoomTo({ startDate: new Date(range.start), endDate: new Date(range.end) });
  }, [range?.start, range?.end, config]);

  if (error)
    return (
      <section className="sheet tl-state">
        <h2>{error.status === 404 ? "The timeline is not served by this build." : "The timeline could not be read."}</h2>
        <p>{error.status === 404 ? "Restart the services on the current backend to add it. Nothing else on this delivery is affected." : error.message}</p>
        <button className="btn btn-outline btn-sm" onClick={() => setTick((n) => n + 1)}>Try again</button>
      </section>
    );
  if (!model || !config)
    return (
      <section className="sheet tl-state" aria-busy="true">
        <div className="skeleton skeleton-block" />
        <p className="sr-only" role="status">Loading the timeline…</p>
      </section>
    );
  if (!model.events.length)
    return (
      <section className="sheet tl-state">
        <h2>Nothing is on the clock yet.</h2>
        <p>Bars appear once PayPal confirms the hold and provider tasks are registered.</p>
      </section>
    );

  const risk = model.atRisk;
  return (
    <>
      <section className="tl-summary" data-risk={risk.length ? "yes" : "no"} role="status">
        {risk.length ? (
          <p>
            <strong>{risk.length === 1 ? `${risk[0].name} is` : `${risk.length} clips are`} not archived yet.</strong>{" "}
            The provider's copy is still inside its published retention ({risk.map((r) => r.name).join(", ")}). Archive before that window closes, or the only route left is a new render.
          </p>
        ) : (
          <p>
            <strong>No clip is waiting on a provider copy.</strong> Every clip with a live provider window is already archived, or no provider window applies.
          </p>
        )}
      </section>

      <section className="sheet tl-sheet">
        <div className="sheet-head tl-head">
          <ul className="tl-legend" aria-label="How to read the bars">
            <li><span className="tl-key tl-key-observed" aria-hidden="true" />Observed · from a record</li>
            <li><span className="tl-key tl-key-estimate" aria-hidden="true" />Estimate · from published terms</li>
            <li><span className="tl-key tl-key-point" aria-hidden="true" />A moment</li>
          </ul>
          <div className="tl-modes" role="group" aria-label="Time range">
            <button className="btn btn-sm" data-on={mode === "race"} aria-pressed={mode === "race"} onClick={() => setMode("race")}>First hours</button>
            <button className="btn btn-sm" data-on={mode === "full"} aria-pressed={mode === "full"} onClick={() => setMode("full")}>Whole window</button>
            <button className="btn btn-outline btn-sm" onClick={() => setTick((n) => n + 1)}>Refresh</button>
          </div>
        </div>
        <div className="tl-chart" aria-hidden="true">
          <BryntumScheduler
            ref={ref}
            autoHeight
            detectCSSCompatibilityIssues={false}
            readOnly
            rowHeight={30}
            barMargin={4}
            resourceMargin={5}
            eventLayout="stack"
            eventStyle={null}
            eventColor={null}
            startDate={new Date(range.start)}
            endDate={new Date(range.end)}
            viewPreset="hourAndDay"
            zoomOnMouseWheel={false}
            zoomOnTimeAxisDoubleClick={false}
            resources={config.resources}
            events={config.events}
            columns={[
              {
                text: "Record",
                field: "name",
                width: 150,
                htmlEncode: false,
                renderer: ({ record }) =>
                  `<span class="tl-row" data-kind="${esc(record.kind)}">${esc(record.name)}${record.atRisk ? '<span class="tl-risk">not archived</span>' : ""}</span>`,
              },
            ]}
            eventRenderer={({ eventRecord }) => (eventRecord.point ? "" : eventRecord.name)}
            timeRangesFeature={{ showCurrentTimeLine: { name: "Now" } }}
            eventTooltipFeature={{
              template: ({ eventRecord: r }) =>
                `<div class="tl-tip"><b>${esc(r.name)}</b><span class="tl-tip-basis" data-basis="${esc(r.basis)}">${r.basis === "ESTIMATE" ? "Estimate" : "Observed"}</span><p>${esc(r.sentence)}</p>${r.note ? `<p>${esc(r.note)}</p>` : ""}</div>`,
            }}
            eventEditFeature={false}
            eventMenuFeature={false}
            scheduleMenuFeature={false}
            cellMenuFeature={false}
            headerMenuFeature={false}
            timeAxisHeaderMenuFeature={false}
            eventDragFeature={false}
            eventResizeFeature={false}
            eventDragCreateFeature={false}
            sortFeature={false}
          />
        </div>
        <details className="tl-list">
          <summary>The same records as a list ({model.events.length})</summary>
          <table className="unit-ledger">
            <thead>
              <tr><th scope="col">Record</th><th scope="col">What</th><th scope="col">Basis</th><th scope="col">From</th><th scope="col">Until</th></tr>
            </thead>
            <tbody>
              {model.events.map((e) => (
                <tr key={e.id}>
                  <td>{model.resources.find((r) => r.id === e.resourceId)?.name}</td>
                  <td>{e.name}{e.note ? <small> · {e.note}</small> : null}</td>
                  <td><span className="tl-basis" data-basis={e.basis}>{e.basis === "ESTIMATE" ? "Estimate" : "Observed"}</span></td>
                  <td>{stamp(new Date(e.start).toISOString())}</td>
                  <td>{e.point ? "—" : e.openEnded ? "not recorded" : stamp(new Date(e.end).toISOString())}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
        <p className="tl-foot">
          Read {stamp(view.generated_at)}. {model.estimates} of {model.events.length} bars are estimates: provider retention is the lower bound each provider publishes, and PayPal honors authorized funds for three days. Timeline by Bryntum Scheduler.
        </p>
      </section>
    </>
  );
}
