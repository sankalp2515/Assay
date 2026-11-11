import type { Context, VideoProvider } from "../core/context.js";
import { unavailable } from "../core/errors.js";

// Where a generation task lives. Runway and Replicate are looked up with the merchant's
// own provider key. "reported" is for any other provider (fal, Veo, Luma, Kling, a
// self-hosted model): the merchant tells Assay the task ID and the output URL, and
// Assay downloads, decodes and verifies the file itself. Nothing is billed on the
// merchant's word alone: billing still needs a stored, verified file and a buyer route.
export const TASK_SOURCES = ["runway", "replicate", "reported"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export function providerFor(ctx: Context, source: TaskSource | undefined): VideoProvider {
  const p =
    !source || source === "runway"
      ? ctx.provider
      : source === "reported"
        ? undefined
        : ctx.providers?.[source];
  if (!p?.available) throw unavailable(source ?? "runway");
  return p;
}

const DEFAULT_HOSTS: Record<TaskSource, string> = {
  runway: "dnznrvs05pmza.cloudfront.net",
  replicate: "replicate.delivery",
  reported: "",
};
const ENV: Record<TaskSource, string> = {
  runway: "RUNWAY_ALLOWED_HOSTS",
  replicate: "REPLICATE_ALLOWED_HOSTS",
  reported: "REPORTED_OUTPUT_HOSTS",
};

// Exact host allow-list per source. Reported output must come from hosts the merchant
// configured in advance, so a task registration can't point the downloader anywhere.
export function outputHosts(source: TaskSource | undefined) {
  const s = source ?? "runway";
  return (process.env[ENV[s]] ?? DEFAULT_HOSTS[s])
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}
