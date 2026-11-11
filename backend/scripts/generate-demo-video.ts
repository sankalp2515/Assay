import { mkdir, readFile, writeFile } from "node:fs/promises";

// Public ZeroGPU demo only. This path has no account, payment method, or paid fallback.
const endpoint =
  "https://lightricks-ltx-video-distilled.hf.space/gradio_api/call/text_to_video";
const dir = ".local/ltx-distilled";
const prompt =
  "A tiny blue paper bird glides left to right above a miniature green paper forest. Warm afternoon light, forward tracking shot, smooth motion, no text.";
await mkdir(dir, { recursive: true });

async function readJson(file: string) {
  try {
    return JSON.parse(await readFile(`${dir}/${file}`, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

let result = await readJson("result.json");
if (!result) {
  let job = await readJson("run.json");
  if (!job) {
    // If the provider accepts the request but no ID returns, preserve uncertainty.
    await writeFile(`${dir}/submission-started`, new Date().toISOString(), {
      flag: "wx",
    });
    const submitted = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: [
          prompt,
          "blurry, jittery, distorted",
          null,
          null,
          736,
          1280,
          "text-to-video",
          4,
          9,
          42,
          false,
          1,
          false,
        ],
      }),
      signal: AbortSignal.timeout(25000),
      redirect: "error",
    });
    if (!submitted.ok)
      throw new Error(
        `Public video submission returned HTTP ${submitted.status}. Check the preserved submission record before any new request.`,
      );
    job = { event_id: (await submitted.json()).event_id, prompt };
    if (typeof job.event_id !== "string")
      throw new Error("Provider returned no event ID");
    await writeFile(`${dir}/run.json`, JSON.stringify(job), { flag: "wx" });
  }
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(job.event_id))
    throw new Error("Invalid provider event ID");
  const stream = await fetch(`${endpoint}/${job.event_id}`, {
    signal: AbortSignal.timeout(240000),
    redirect: "error",
  });
  if (!stream.ok)
    throw new Error(`Public video result returned HTTP ${stream.status}`);
  for (const event of (await stream.text()).split(/\r?\n\r?\n/)) {
    const match = /^event: (complete|error)\r?\ndata: (.*)$/m.exec(event);
    if (!match) continue;
    result = { event: match[1], data: JSON.parse(match[2]!) };
    await writeFile(`${dir}/result.json`, JSON.stringify(result), {
      flag: "wx",
    });
    break;
  }
}
if (result?.event !== "complete")
  throw new Error(
    "Public video job did not complete. No automatic resubmission or paid fallback.",
  );
console.log(
  "Completed ZeroGPU result is available privately. Run npm run verify:generated-video -- --media-only to verify the original.",
);
