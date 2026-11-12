import { useEffect, useState } from "react";
import {
  CompassIcon,
  SquaresFourIcon,
  ScanIcon,
  ChartBarIcon,
  ClockIcon,
  SparkleIcon,
  ScalesIcon,
  ScrollIcon,
  CreditCardIcon,
  ChatTextIcon,
  GearSixIcon,
  FilmStripIcon,
  SunIcon,
  MoonIcon,
  ArrowLeftIcon,
} from "@phosphor-icons/react";

export function useInputMode() {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.input = "keyboard";
    const pointer = () => {
      root.dataset.input = "pointer";
    };
    const keyboard = () => {
      root.dataset.input = "keyboard";
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", keyboard, true);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", keyboard, true);
    };
  }, []);
}

export function useTheme() {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  const set = (next) => {
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("assay-theme", next ? "dark" : "light");
    } catch {
      /* Preference only. */
    }
    setDark(next);
  };
  return [dark, set];
}
export function ThemeToggle() {
  const [dark, setDark] = useTheme();
  return (
    <div className="theme-toggle" role="group" aria-label="Colour theme">
      <button aria-pressed={!dark} aria-label="Paper theme" onClick={() => setDark(false)}>
        <SunIcon size={14} aria-hidden="true" />
        <span>Paper</span>
      </button>
      <button aria-pressed={dark} aria-label="Darkroom theme" onClick={() => setDark(true)}>
        <MoonIcon size={14} aria-hidden="true" />
        <span>Darkroom</span>
      </button>
    </div>
  );
}
export function Mark({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M1 12h6M17 12h6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="4.25" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}
export function Brand({ href = "#/" }) {
  return (
    <a className="assay-brand" href={href} aria-label="Assay, home">
      <Mark />
      <span>Assay</span>
    </a>
  );
}

const TITLES = {
  batches: "Command center",
  buyer: "Your delivery",
  payments: "Payments",
  tasks: "Provider tasks",
  activity: "Activity",
  support: "Buyer messages",
  settings: "Workspace",
  operations: "Operations",
  new: "New delivery",
  start: "Start here",
  dashboard: "Dashboard",
  signup: "Create account",
  signin: "Sign in",
  privacy: "Privacy and retention",
};
const CASE_TITLES = {
  "": "Investigation",
  analysis: "AI analysis",
  settlement: "Settlement",
  record: "Resolution record",
};

export function ProductShell({
  role,
  demo,
  session,
  environment,
  envKind,
  path,
  batchId,
  connect,
  children,
}) {
  useInputMode();
  const parts = path.split("/").filter(Boolean);
  const current = parts[0] || "batches";
  const sub = current === "batches" && batchId ? parts[2] || "" : null;
  const pageName = sub !== null ? CASE_TITLES[sub] || "Investigation" : TITLES[current] || "Assay";
  useEffect(() => {
    document.title = `${pageName} · Assay`;
  }, [pageName]);
  // Keep the last opened delivery so case links stay live from other pages.
  const [lastCase, setLastCase] = useState(() => {
    try {
      return sessionStorage.getItem("assay-case") || "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    if (batchId && ["batches", "payments", "support", "tasks", "buyer", "activity"].includes(current)) {
      setLastCase(batchId);
      try {
        sessionStorage.setItem("assay-case", batchId);
      } catch {
        /* Optional. */
      }
    }
  }, [batchId, current]);
  const caseId = batchId || lastCase;
  const merchant = session?.merchant_name || (demo ? "Lumen Reel" : "Merchant workspace");

  if (role === "buyer")
    return (
      <div className="buyer-shell">
        <a className="skip-link" href="#main">Skip to content</a>
        <header className="buyer-top">
          <span className="merchant">{session?.merchant_name || (demo ? "Lumen Reel" : "Your studio")}</span>
          <span className="eyebrow">
            Delivery verified by <Mark size={14} /> Assay
          </span>
          {!session && caseId && (
            <a className="text-link" href={`#/batches/${caseId}`}>
              <ArrowLeftIcon size={14} aria-hidden="true" />
              Merchant workspace
            </a>
          )}
          {session?.demo && (
            <a className="text-link" href={`/api/demo-login?as=operator&returnTo=${encodeURIComponent("/#/start")}`}>
              <ArrowLeftIcon size={14} aria-hidden="true" />
              Back to the guided steps
            </a>
          )}
          <span className="tag-env" data-env={envKind}>{environment}</span>
          <ThemeToggle />
        </header>
        {children}
        <footer className="assay-foot">
          <span>You are charged only for clips you can open.</span>
          <a href="#/privacy">Privacy and retention</a>
        </footer>
      </div>
    );

  const item = (to, label, Icon, active, enabled = true, count) => (
    <a
      key={label}
      href={enabled ? `#${to}` : undefined}
      aria-current={active ? "page" : undefined}
      aria-disabled={enabled ? undefined : "true"}
      title={enabled ? undefined : "Open a delivery first"}
    >
      <Icon size={16} aria-hidden="true" />
      <span>{label}</span>
      {count ? <span className="count">{count}</span> : null}
    </a>
  );
  const workspace = [
    item("/start", "Start here", CompassIcon, current === "start" || current === "signup"),
    item("/batches", "Command center", SquaresFourIcon, (current === "batches" && !batchId) || current === "new"),
    item(`/batches/${caseId}`, "Investigation", ScanIcon, sub === "", !!caseId, caseId ? caseId.slice(0, 4) : null),
    item(`/batches/${caseId}/timeline`, "Recovery window", ClockIcon, sub === "timeline", !!caseId),
    item(`/batches/${caseId}/analysis`, "AI analysis", SparkleIcon, sub === "analysis", !!caseId),
    item(`/batches/${caseId}/settlement`, "Settlement", ScalesIcon, sub === "settlement", !!caseId),
    item(`/batches/${caseId}/record`, "Resolution record", ScrollIcon, sub === "record", !!caseId),
  ];
  const records = [
    item("/dashboard", "Dashboard", ChartBarIcon, current === "dashboard"),
    item("/payments", "Payments", CreditCardIcon, current === "payments"),
    item("/support", "Buyer messages", ChatTextIcon, current === "support"),
    item("/settings", "Workspace", GearSixIcon, current === "settings" || current === "operations"),
  ];
  const customer = [item(`/buyer/${caseId}`, "Customer delivery", FilmStripIcon, false, !!caseId)];

  return (
    <div className="assay-shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <aside className="assay-side">
        <Brand />
        <p className="eyebrow side-label">Merchant workspace</p>
        <nav className="side-nav" aria-label="Workspace">{workspace}</nav>
        <p className="eyebrow side-label">Records</p>
        <nav className="side-nav" aria-label="Records">{records}</nav>
        <p className="eyebrow side-label">What the customer sees</p>
        <nav className="side-nav" aria-label="Customer view">{customer}</nav>
        <div className="side-foot">
          <strong>{merchant}</strong>
          <span>{demo ? "Fictional AI-video studio" : "Single merchant · USD"}</span>
          <span className="side-status" data-env={envKind}>{environment}</span>
          {demo && import.meta.env.DEV && (
            <button className="text-link" onClick={connect}>Use local services</button>
          )}
          {!demo && <a href="#/operations">Operations</a>}
        </div>
      </aside>
      <div className="assay-main">
        <header className="assay-top">
          <Brand />
          <div className="crumb">
            <span className="eyebrow">{sub !== null ? "Delivery" : "Workspace"}</span>
            <strong>{pageName}</strong>
          </div>
          <a className="tag-env" data-env={envKind} href="#/settings" title="Where these records come from">
            {environment}
          </a>
          <ThemeToggle />
        </header>
        <nav className="mobile-tabs" aria-label="Sections">{[...workspace, ...records, ...customer]}</nav>
        {children}
        <footer className="assay-foot">
          <span>{demo ? "Illustrative walkthrough. No services, no payments." : "AI proposes. You approve. PayPal moves the money once."}</span>
          <a href="#/privacy">Privacy and retention</a>
        </footer>
      </div>
    </div>
  );
}
