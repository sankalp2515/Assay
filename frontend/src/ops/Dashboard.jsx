// Merchant operations dashboard, built on AG Studio. The rows are the service's own
// (GET /v1/operations/dashboard); Studio lets the merchant rearrange and add widgets.
// The Studio AI assistant is not enabled: nothing here calls a model.
import { useEffect, useMemo, useRef, useState } from "react";
import { studioTheme } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { request } from "../api.js";
import { stamp } from "../ui/kit.jsx";
import { dashboardData } from "./dashboard-model.js";
import "./dashboard.css";

const v = (name) => `var(--${name})`;
const line = (name) => ({ width: 1, color: v(name) });
// Charts draw on a canvas and cannot read the oklch tokens, so each token is painted once
// and read back as plain RGB. Recomputed when the Paper/Darkroom theme changes.
function rgb(name) {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim() || "#000";
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}
// One palette for every chart, in Assay roles: delivered or charged, held back, not there, broken.
const PALETTE = ["verified", "proof", "muted", "broken", "ink-soft", "pending", "ink", "input", "proof-hover", "rule"];
function chartParams() {
  return {
    chartTextColor: rgb("ink"),
    chartSubtleTextColor: rgb("muted"),
    chartAxisLineColor: rgb("rule"),
    chartGridLineColor: rgb("rule"),
    ...Object.fromEntries(
      PALETTE.flatMap((name, i) => [
        [`chartPaletteFills${i + 1}Color`, rgb(name)],
        [`chartPaletteStrokes${i + 1}Color`, rgb(name)],
      ]),
    ),
  };
}
function useDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const o = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => o.disconnect();
  }, []);
  return dark;
}
const baseTheme = studioTheme.withParams({
  fontFamily: v("font-sans"),
  fontSize: 13.5,
  textColor: v("ink"),
  foregroundColor: v("ink"),
  subtleTextColor: v("muted"),
  backgroundColor: v("card"),
  borderColor: v("rule"),
  accentColor: v("proof"),
  iconColor: v("ink-soft"),
  rowHoverColor: v("paper-deep"),
  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: v("paper"),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: v("paper"),
  studioCanvasPadding: 0,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: v("font-sans"),
  studioWidgetBackgroundColor: v("card"),
  studioWidgetBorder: line("rule"),
  studioWidgetBorderRadius: 8,
  studioWidgetPadding: 12,
  studioWidgetTitleFontFamily: v("font-sans"),
  studioWidgetTitleFontSize: 13.5,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: v("ink"),
  studioWidgetCaptionTextColor: v("muted"),
  studioPanelContainerBackgroundColor: v("card"),
  studioPanelContainerBorder: line("rule"),
  studioPanelDividerColor: v("rule"),
  studioPanelSectionBorderColor: v("rule"),
  gridFontFamily: v("font-sans"),
  gridFontSize: 13,
  gridCellTextColor: v("ink"),
  gridHeaderBackgroundColor: v("paper-deep"),
  gridHeaderTextColor: v("muted"),
  gridHeaderFontWeight: 600,
  gridHeaderFontSize: 12,
  gridRowHeight: 36,
  gridRowBorder: line("rule"),
  gridHeaderRowBorder: line("rule"),
  gridRowHoverColor: v("paper-deep"),
  gridWrapperBorder: false,
  chartFontFamily: v("font-sans"),
});

const F = (specs) => specs.map(([id, name, format, hide]) => ({ id, name, format, ...(hide && { hide }) }));
function studioData({ deliveries, clips }) {
  return {
    description:
      "Assay delivery records for one merchant. Money is in the major unit of each row's currency and is not converted: filter to one currency before adding amounts. 'Never taken' is the part of a PayPal hold that was not captured; it is not a refund.",
    sources: [
      {
        id: "deliveries",
        description: "One row per delivery (batch of clips under one PayPal authorization).",
        data: deliveries,
        fields: F([
          ["id", "Delivery ID", "textFormat", true],
          ["title", "Delivery", "textFormat"],
          ["created", "Opened", "dateTimeFormat"],
          ["state", "State", "textFormat"],
          ["settled", "Settled", "booleanFormat"],
          ["currency", "Currency", "textFormat"],
          ["clips", "Clips ordered", "integerFormat"],
          ["delivered", "Delivered", "integerFormat"],
          ["recovered", "Recovered, no new render", "integerFormat"],
          ["recoverable", "Archived, not delivered", "integerFormat"],
          ["undelivered", "Not rendered or failed", "integerFormat"],
          ["noTask", "No provider task", "integerFormat"],
          ["authorized", "Authorized", "decimalFormat"],
          ["charged", "Charged", "decimalFormat"],
          ["notTaken", "Never taken", "decimalFormat"],
          ["refunded", "Refunded", "decimalFormat"],
          ["openDisputes", "Open disputes", "integerFormat"],
          ["disputeDeadline", "Next dispute deadline", "dateTimeFormat"],
          ["playbackPlayed", "Played in outside browser", "integerFormat"],
          ["playbackProbed", "Outside playback checks", "integerFormat"],
        ]),
      },
      {
        id: "clips",
        description: "One row per clip in those deliveries.",
        data: clips,
        fields: F([
          ["id", "Clip ID", "textFormat", true],
          ["batchId", "Delivery ID", "textFormat", true],
          ["clip", "Clip", "textFormat"],
          ["currency", "Clip currency", "textFormat", true],
          ["price", "Price", "decimalFormat"],
          ["provider", "Provider", "textFormat"],
          ["task", "Provider task", "textFormat"],
          ["outcome", "Outcome", "textFormat"],
          ["archived", "Archived", "booleanFormat"],
          ["delivered", "Buyer can open", "booleanFormat"],
          ["recovered", "Recovered", "booleanFormat"],
          ["playback", "Outside playback", "textFormat"],
        ]),
      },
    ],
    relationships: [
      { id: "clip-delivery", source: { tableId: "clips", fieldId: "batchId" }, target: { tableId: "deliveries", fieldId: "id" }, type: "many-to-one" },
    ],
  };
}

const at = (xTrack, yTrack, xSpan, ySpan) => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text) => ({ title: { enabled: true, text } });
const sum = (id) => ({ id, aggregation: "sum" });
const kpi = (text, value) => ({ type: "value", dataMapping: { value: [value] }, format: title(text) });
function report(currency) {
  const overview = {
    id: "overview",
    widgets: {
      currency: {
        type: "button-filter",
        dataMapping: { value: [{ id: "deliveries.currency" }] },
        format: { ...title("Currency"), style: { selection: { type: "single" } } },
      },
      "kpi-clips": kpi("Clips ordered", sum("deliveries.clips")),
      "kpi-delivered": kpi("Delivered", sum("deliveries.delivered")),
      "kpi-recovered": kpi("Recovered, no new render", sum("deliveries.recovered")),
      "kpi-charged": kpi("Charged", sum("deliveries.charged")),
      "kpi-not-taken": kpi("Never taken", sum("deliveries.notTaken")),
      "clip-standing": {
        type: "column-chart-stacked",
        dataMapping: {
          categoryKey: [{ id: "deliveries.title" }],
          valueKey: [sum("deliveries.delivered"), sum("deliveries.recoverable"), sum("deliveries.undelivered")],
        },
        format: { ...title("Where each delivery's clips stand"), style: { theme: { common: { legend: { enabled: true } } } } },
      },
      "hold-split": {
        type: "bar-chart-stacked",
        dataMapping: {
          categoryKey: [{ id: "deliveries.title" }],
          valueKey: [sum("deliveries.charged"), sum("deliveries.notTaken")],
        },
        format: { ...title("Each PayPal hold: charged and never taken"), style: { theme: { common: { legend: { enabled: true } } } } },
      },
      deliveries: {
        type: "grid",
        dataMapping: {
          cols: [
            { id: "deliveries.title" },
            { id: "deliveries.created" },
            { id: "deliveries.state" },
            sum("deliveries.clips"),
            sum("deliveries.delivered"),
            sum("deliveries.recovered"),
            sum("deliveries.recoverable"),
            sum("deliveries.authorized"),
            sum("deliveries.charged"),
            sum("deliveries.notTaken"),
            sum("deliveries.refunded"),
            sum("deliveries.openDisputes"),
          ],
        },
        sort: [{ field: { id: "deliveries.created" }, direction: "desc" }],
        format: title("Deliveries, newest first"),
      },
    },
    widgetLayout: {
      "kpi-clips": at(0, 0, 4, 6),
      "kpi-delivered": at(4, 0, 4, 6),
      "kpi-recovered": at(8, 0, 4, 6),
      "kpi-charged": at(12, 0, 4, 6),
      "kpi-not-taken": at(16, 0, 4, 6),
      currency: at(20, 0, 4, 6),
      "clip-standing": at(0, 6, 12, 16),
      "hold-split": at(12, 6, 12, 16),
      deliveries: at(0, 22, 24, 18),
    },
    filter: {
      page: [{ field: { id: "deliveries.currency" }, model: { operator: "isIn", value: [currency] }, filterWidgetId: "currency" }],
    },
  };
  const clips = {
    id: "clips",
    widgets: {
      outcomes: {
        type: "donut-chart",
        dataMapping: { categoryKey: [{ id: "clips.outcome" }], valueKey: [{ id: "clips.id", aggregation: "countd" }] },
        format: title("Clips by outcome"),
      },
      tasks: {
        type: "column-chart-stacked",
        dataMapping: {
          categoryKey: [{ id: "clips.provider" }],
          valueKey: [{ id: "clips.id", aggregation: "countd" }],
          legendKey: [{ id: "clips.task" }],
        },
        format: { ...title("Provider tasks by provider and state"), style: { theme: { common: { legend: { enabled: true } } } } },
      },
      "clip-grid": {
        type: "grid",
        dataMapping: {
          cols: [
            { id: "deliveries.title" },
            { id: "clips.clip" },
            { id: "clips.outcome" },
            { id: "clips.provider" },
            { id: "clips.task" },
            { id: "clips.playback" },
            { id: "deliveries.currency" },
            sum("clips.price"),
          ],
        },
        format: title("Every clip"),
      },
    },
    widgetLayout: {
      outcomes: at(0, 0, 9, 16),
      tasks: at(9, 0, 15, 16),
      "clip-grid": at(0, 16, 24, 22),
    },
  };
  // The filters panel starts collapsed so the widgets get the width; the currency switch stays on the canvas.
  return { selectedPageId: "overview", pages: [overview, clips], panels: { filters: { collapsed: true } } };
}

export default function Dashboard({ envKind }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const [mode, setMode] = useState("view");
  const [page, setPage] = useState("overview");
  const api = useRef(null);
  const dark = useDark();
  const theme = useMemo(() => baseTheme.withParams(chartParams()), [dark]);

  useEffect(() => {
    let live = true;
    setError(null);
    Promise.all([
      request("/v1/operations/dashboard?level=batch&limit=50"),
      request("/v1/operations/dashboard?level=clip&limit=50"),
    ])
      .then(([b, c]) => live && setRows({ batch: b.rows || [], clip: c.rows || [], at: b.generated_at }))
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [envKind, tick]);

  const model = useMemo(() => (rows ? dashboardData(rows.batch, rows.clip) : null), [rows]);
  const data = useMemo(() => (model ? studioData(model) : null), [model]);
  const [initial, setInitial] = useState(null);
  useEffect(() => {
    if (model && !initial && model.currencies.length) setInitial(report(model.currencies[0]));
  }, [model, initial]);

  const go = (id) => {
    setPage(id);
    const a = api.current;
    if (a) a.setState({ ...a.getState(), selectedPageId: id });
  };

  if (error)
    return (
      <section className="sheet dash-state">
        <h2>{error.status === 404 ? "The dashboard rows are not served by this build." : "The dashboard could not be read."}</h2>
        <p>{error.status === 404 ? "Restart the services on the current backend to add them." : error.message}</p>
        <button className="btn btn-outline btn-sm" onClick={() => setTick((n) => n + 1)}>Try again</button>
      </section>
    );
  if (!model)
    return (
      <section className="sheet dash-state" aria-busy="true">
        <div className="skeleton skeleton-block" />
        <p className="sr-only" role="status">Loading the dashboard…</p>
      </section>
    );
  if (!model.deliveries.length || !initial)
    return (
      <section className="sheet dash-state">
        <h2>No deliveries yet.</h2>
        <p>The dashboard fills in once a delivery exists.</p>
        <a className="btn btn-proof btn-sm" href="#/start">Start here</a>
      </section>
    );

  return (
    <section className="dash">
      <div className="dash-bar">
        <div className="dash-tabs" role="group" aria-label="Dashboard page">
          <button className="btn btn-sm" data-on={page === "overview"} aria-pressed={page === "overview"} onClick={() => go("overview")}>Deliveries</button>
          <button className="btn btn-sm" data-on={page === "clips"} aria-pressed={page === "clips"} onClick={() => go("clips")}>Clips</button>
        </div>
        <p className="dash-note">
          {model.currencies.length > 1
            ? `Amounts are shown for one currency at a time (${model.currencies.join(", ")}). They are never added together.`
            : `All amounts are in ${model.currencies[0]}.`}{" "}
          Read {stamp(rows.at)}.
        </p>
        <div className="dash-actions">
          <button className="btn btn-outline btn-sm" aria-pressed={mode === "edit"} onClick={() => setMode(mode === "edit" ? "view" : "edit")}>
            {mode === "edit" ? "Done arranging" : "Arrange widgets"}
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => setTick((n) => n + 1)}>Refresh</button>
        </div>
      </div>
      <div className="dash-studio" data-mode={mode}>
        <AgStudioProvider licenseKey={import.meta.env.VITE_AGSTUDIO_LICENSE_KEY || undefined}>
          <AgStudio
            style={{ height: "100%", width: "100%" }}
            theme={theme}
            layout={{ widgetBorderEnabled: true }}
            data={data}
            initialState={initial}
            mode={mode}
            onApiReady={(e) => {
              api.current = e.api;
            }}
            onStateUpdated={(e) => setPage(e.state.selectedPageId)}
          />
        </AgStudioProvider>
      </div>
      <p className="dash-foot">
        Rows come from Assay's own records. “Never taken” is the part of a PayPal hold that was not captured; it is not a refund, and it stays empty until a delivery is settled. Your widget changes last for this visit only. Dashboard by AG Studio.
      </p>
    </section>
  );
}
