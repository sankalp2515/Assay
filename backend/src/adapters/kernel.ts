import Kernel from "@onkernel/sdk";

// External playback proof. Assay's own buyer-route check fetches the clip from inside
// its network and compares the digest; that proves the file is served and intact. This
// probe asks a real Chromium browser in KERNEL's cloud to fetch the same clip over the
// public internet, hash the bytes it received, and actually play it. The session is
// recorded, so a merchant can show a dispute reviewer the clip playing.
//
// It never decides money: settlement still rests on the stored file and the buyer-route
// receipt. A failed or unavailable probe is reported as such, never hidden.
export type ProbeOutcome =
  | "PLAYED"
  | "NOT_PLAYED"
  | "FETCH_FAILED"
  | "DIGEST_MISMATCH"
  | "PROBE_ERROR";
export interface ProbeResult {
  outcome: ProbeOutcome;
  http_status: number | null;
  bytes: number | null;
  sha256: string | null;
  current_time: number | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  replay_id: string | null;
  replay_view_url: string | null;
  browser: "kernel-chromium";
  // Why the probe could not run, when it could not (truncated, no secrets).
  error: string | null;
}
export interface ProbeInput {
  // A same-origin page to open first, so the clip fetch needs no CORS.
  pageUrl: string;
  contentUrl: string;
  // Short-lived bearer for the content route, if it needs one.
  bearer?: string;
  expectedSha256?: string;
}
export interface PlaybackProber {
  available: boolean;
  probe(input: ProbeInput): Promise<ProbeResult>;
}

// Runs inside the remote browser (KERNEL Playwright execution). A plain script string, so
// no build-tool helper can leak into code that runs on someone else's machine.
export const PROBE_SCRIPT = `async (args) => {
  const res = await fetch(args.contentUrl, {
    headers: args.bearer ? { authorization: "Bearer " + args.bearer } : {},
    cache: "no-store",
  });
  if (!res.ok) return { ok: false, status: res.status };
  const buf = await res.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const sha256 = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  // createElementNS works even when the opened page is not an HTML document.
  const video = document.createElementNS("http://www.w3.org/1999/xhtml", "video");
  video.muted = true;
  video.playsInline = true;
  (document.body || document.documentElement).replaceChildren(video);
  video.src = URL.createObjectURL(new Blob([buf], { type: "video/mp4" }));
  const played = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 15000);
    video.addEventListener("timeupdate", () => {
      if (video.currentTime > 0.5) { clearTimeout(timer); resolve(true); }
    });
    video.addEventListener("error", () => { clearTimeout(timer); resolve(false); });
    video.play().catch(() => undefined);
  });
  return {
    ok: true, status: res.status, bytes: buf.byteLength, sha256, played,
    currentTime: video.currentTime,
    duration: Number.isFinite(video.duration) ? video.duration : null,
    width: video.videoWidth, height: video.videoHeight,
  };
}`;

type Remote = {
  ok: boolean;
  status: number;
  bytes?: number;
  sha256?: string;
  played?: boolean;
  currentTime?: number;
  duration?: number | null;
  width?: number;
  height?: number;
};

export function interpret(r: Remote | undefined, expected?: string): Omit<ProbeResult, "replay_id" | "replay_view_url" | "browser" | "error"> {
  if (!r) return blank("PROBE_ERROR");
  if (!r.ok) return { ...blank("FETCH_FAILED"), http_status: r.status };
  const base = {
    http_status: r.status,
    bytes: r.bytes ?? null,
    sha256: r.sha256 ?? null,
    current_time: r.currentTime ?? null,
    duration: r.duration ?? null,
    width: r.width ?? null,
    height: r.height ?? null,
  };
  if (expected && r.sha256 !== expected) return { outcome: "DIGEST_MISMATCH", ...base };
  return { outcome: r.played ? "PLAYED" : "NOT_PLAYED", ...base };
}
const blank = (outcome: ProbeOutcome) => ({
  outcome,
  http_status: null,
  bytes: null,
  sha256: null,
  current_time: null,
  duration: null,
  width: null,
  height: null,
});

export class KernelProber implements PlaybackProber {
  available: boolean;
  private client: Kernel | undefined;
  constructor(apiKey: string) {
    this.available = apiKey.length > 20;
    this.client = this.available ? new Kernel({ apiKey, timeout: 60000, maxRetries: 1 }) : undefined;
  }
  async probe(input: ProbeInput): Promise<ProbeResult> {
    if (!this.client) throw new Error("KERNEL is not configured");
    const page = new URL(input.pageUrl);
    const content = new URL(input.contentUrl);
    if (page.protocol !== "https:" || content.origin !== page.origin)
      throw new Error("Probe page and content must share one https origin");
    const kernel = this.client;
    const browser = await kernel.browsers.create({ headless: false, timeout_seconds: 120 });
    let replayId: string | null = null;
    let replayUrl: string | null = null;
    try {
      try {
        replayId = (await kernel.browsers.replays.start(browser.session_id)).replay_id;
      } catch {
        replayId = null; // a probe without a recording is still a probe
      }
      const code =
        `await page.goto(${JSON.stringify(page.toString())}, { waitUntil: "domcontentloaded" });\n` +
        `return await page.evaluate(${PROBE_SCRIPT}, ${JSON.stringify({
          contentUrl: content.toString(),
          bearer: input.bearer,
        })});`;
      const run = await kernel.browsers.playwright.execute(browser.session_id, { code, timeout_sec: 60 });
      const remote = run.success ? (run.result as Remote) : undefined;
      const error = run.success ? null : String(run.error ?? run.stderr ?? "execution failed").slice(0, 300);
      if (replayId) {
        try {
          await kernel.browsers.replays.stop(replayId, { id_or_name: browser.session_id });
          const list = await kernel.browsers.replays.list(browser.session_id);
          replayUrl = list.find((x) => x.replay_id === replayId)?.replay_view_url ?? null;
        } catch {
          replayUrl = null;
        }
      }
      return {
        ...interpret(remote, input.expectedSha256),
        replay_id: replayId,
        replay_view_url: replayUrl,
        browser: "kernel-chromium",
        error,
      };
    } finally {
      await kernel.browsers.deleteByID(browser.session_id).catch(() => undefined);
    }
  }
}
