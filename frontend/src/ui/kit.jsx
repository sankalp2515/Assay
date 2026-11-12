// Shared primitives for the Quiet ledger system. See root DESIGN.md.
import { useEffect, useId, useRef, useState } from "react";
import {
  CheckCircleIcon,
  CircleDashedIcon,
  CircleHalfIcon,
  CircleIcon,
  QuestionIcon,
  XCircleIcon,
  ArrowUUpLeftIcon,
  SparkleIcon,
  XIcon,
  PlayIcon,
  PauseIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
  CornersOutIcon,
  SpinnerGapIcon,
  VideoCameraSlashIcon,
  CopyIcon,
  CheckIcon,
} from "@phosphor-icons/react";

// Each state has its own glyph, so meaning never rests on color alone.
const GLYPH = {
  confirmed: [CheckCircleIcon, "fill"],
  authorized: [CircleIcon, "bold"],
  pending: [CircleHalfIcon, "fill"],
  unknown: [QuestionIcon, "bold"],
  failed: [XCircleIcon, "fill"],
  refunded: [ArrowUUpLeftIcon, "bold"],
  neutral: [CircleDashedIcon, "regular"],
  ai: [SparkleIcon, "fill"],
};

// Smooth scrolling is movement; people who ask for less motion get an instant jump.
export const scrollBehavior = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

export function Chip({ tone = "neutral", children, title, quiet = false }) {
  const [Icon, weight] = GLYPH[tone] || GLYPH.neutral;
  return (
    <span className={`chip${quiet ? " chip-quiet" : ""}`} data-tone={tone} title={title}>
      <Icon size={14} weight={weight} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

export function Reference({ value, label = "reference" }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      className="reference-chip"
      title={`Copy ${label}: ${value}`}
      aria-label={`Copy ${label} ${value}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(String(value));
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          /* Clipboard unavailable; the value stays visible. */
        }
      }}
    >
      <code>{String(value).length > 22 ? `${String(value).slice(0, 10)}…${String(value).slice(-6)}` : value}</code>
      {copied ? <CheckIcon size={12} aria-hidden="true" /> : <CopyIcon size={12} aria-hidden="true" />}
      <span className="sr-only" role="status">{copied ? "Copied" : ""}</span>
    </button>
  );
}

export function Modal({ title, children, onClose, wide = false, eyebrow }) {
  const dialog = useRef(null);
  const titleId = useId();
  const previousFocus = useRef(document.activeElement);
  useEffect(() => {
    const node = dialog.current;
    node.showModal();
    return () => {
      node.close();
      previousFocus.current?.focus?.();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className={`dialog ${wide ? "wide" : ""}`}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const controls = [
          ...e.currentTarget.querySelectorAll(
            'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
          ),
        ].filter((node) => node.getClientRects().length);
        const first = controls[0],
          last = controls.at(-1);
        if (!first) return e.preventDefault();
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-header">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2 id={titleId}>{title}</h2>
        </div>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <XIcon size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

const timecode = (n) =>
  `${Math.floor((n || 0) / 60)}:${String(Math.floor((n || 0) % 60)).padStart(2, "0")}`;

/** Dark screening surface. Plays only bytes fetched through the delivery route. */
export function Screening({ src, state, label, caption, emptyTitle, emptyBody, onRetry, poster, backdrop }) {
  const video = useRef(null),
    stage = useRef(null);
  const [playing, setPlaying] = useState(false),
    [muted, setMuted] = useState(true),
    [time, setTime] = useState(0),
    [duration, setDuration] = useState(0),
    [problem, setProblem] = useState("");
  useEffect(() => {
    setPlaying(false);
    setTime(0);
    setDuration(0);
    setProblem("");
  }, [src]);
  const toggle = async () => {
    if (!video.current) return;
    try {
      if (video.current.paused) await video.current.play();
      else video.current.pause();
    } catch {
      setProblem("Playback could not start in this browser.");
    }
  };
  const full = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.current?.requestFullscreen();
    } catch {
      setProblem("Fullscreen is unavailable in this browser.");
    }
  };
  return (
    <figure className="screening" ref={stage} data-state={state}>
      <div className="screening-frame">
        {state === "available" && src ? (
          <video
            ref={video}
            src={src}
            poster={poster}
            playsInline
            muted={muted}
            preload="metadata"
            aria-label={label}
            onClick={toggle}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onError={() => setProblem("This file could not be decoded.")}
          />
        ) : state === "loading" ? (
          <div className="screening-empty" role="status">
            <SpinnerGapIcon size={26} className="spin" aria-hidden="true" />
            <p>Fetching through the buyer delivery route…</p>
          </div>
        ) : (
          <div className="screening-empty" data-backdrop={backdrop ? "" : undefined}>
            {backdrop && <img className="screening-backdrop" src={backdrop} alt="" />}
            {backdrop && <span className="screening-note">Illustrative still</span>}
            <VideoCameraSlashIcon size={34} weight="light" aria-hidden="true" />
            <h3>{emptyTitle || "No file to show"}</h3>
            {emptyBody && <p>{emptyBody}</p>}
            {state === "unavailable" && onRetry && (
              <button className="screening-button" onClick={onRetry}>
                Try the delivery route again
              </button>
            )}
          </div>
        )}
        {caption && <figcaption className="screening-caption">{caption}</figcaption>}
      </div>
      {state === "available" && src && (
        <div className="screening-controls">
          <button className="icon-button" aria-label={playing ? "Pause video" : "Play video"} onClick={toggle}>
            {playing ? <PauseIcon size={18} weight="fill" /> : <PlayIcon size={18} weight="fill" />}
          </button>
          <span className="timecode">
            {timecode(time)} / {timecode(duration)}
          </span>
          <input
            type="range"
            min="0"
            max={Number.isFinite(duration) && duration ? duration : 1}
            step="0.05"
            value={time}
            aria-label="Video position"
            onChange={(e) => {
              if (video.current) {
                video.current.currentTime = Number(e.target.value);
                setTime(Number(e.target.value));
              }
            }}
          />
          <button className="icon-button" aria-label={muted ? "Unmute video" : "Mute video"} onClick={() => setMuted(!muted)}>
            {muted ? <SpeakerSlashIcon size={18} /> : <SpeakerHighIcon size={18} />}
          </button>
          <button className="icon-button" aria-label="Toggle fullscreen" onClick={full}>
            <CornersOutIcon size={18} />
          </button>
        </div>
      )}
      {problem && (
        <p className="screening-problem" role="alert">
          {problem}
        </p>
      )}
    </figure>
  );
}

export function Countdown({ expiresAt, onExpire }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
  useEffect(() => {
    if (left === 0) onExpire?.();
  }, [left === 0]);
  return left;
}

export const formatBytes = (n) =>
  !Number.isFinite(n) ? "—" : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MiB` : `${Math.max(1, Math.round(n / 1024))} KiB`;
export const stamp = (value, withSeconds = false) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        ...(withSeconds ? { second: "2-digit" } : {}),
      })
    : "Not recorded";
export const clock = (value) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    : "—";

/** A visible wait state: says what is loading, with a moving bar. */
export function LoadingCard({ label, note, className = "" }) {
  return (
    <section className={`sheet loading-card ${className}`} aria-busy="true">
      <p className="loading-label" role="status">{label}</p>
      {note && <p className="loading-note">{note}</p>}
      <span className="loading-bar" aria-hidden="true"><span /></span>
    </section>
  );
}
