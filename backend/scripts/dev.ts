import "./config.js";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { services } from "../src/domain/contracts.js";
const demo = JSON.parse(await readFile(".local/demo.json", "utf8")) as {
  tenant_id: string;
};
const children = services.map((name, index) => {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    NODE_ENV: "development",
    SERVICE_NAME: name,
    PORT: String(4100 + index),
    AUTO_MIGRATE: "true",
    TENANT_IDS: demo.tenant_id,
    MERCHANT_TENANT_ID: demo.tenant_id,
  };
  const specific =
    name === "payments"
      ? [
          "PAYPAL_CLIENT_ID",
          "PAYPAL_CLIENT_SECRET",
          "PAYPAL_MERCHANT_ID",
          "PAYPAL_WEBHOOK_ID",
          "PAYPAL_RETURN_URL",
          "PAYPAL_CANCEL_URL",
        ]
      : name === "investigation"
        ? [
            "AI_FALLBACK_PROVIDERS",
            "AI_ZERO_COST_ONLY",
            "GEMINI_FREE_TIER_CONFIRMED",
            "GROQ_FREE_TIER_CONFIRMED",
            "NVIDIA_FREE_TIER_CONFIRMED",
            "GROQ_API_KEY",
            "GROQ_MODEL",
            "NVIDIA_API_KEY",
            "NVIDIA_MODEL",
            "GEMINI_API_KEY",
            "GEMINI_MODEL",
            "MAX_AI_ASSESSMENTS_PER_DAY",
          ]
        : name === "provider"
          ? [
              "RUNWAY_API_KEY",
              "RUNWAY_MODEL",
              "REPLICATE_API_TOKEN",
              "REPORTED_OUTPUT_HOSTS",
              "ALLOW_PAID_INFERENCE",
              "MAX_PROVIDER_ATTEMPTS",
            ]
          : name === "delivery"
            ? [
                "RUNWAY_ALLOWED_HOSTS",
                "REPLICATE_ALLOWED_HOSTS",
                "REPORTED_OUTPUT_HOSTS",
                "FFPROBE_PATH",
                "FFMPEG_PATH",
                "MEDIA_VERIFIER_URL",
                "MEDIA_VERIFIER_TOKEN",
              ]
            : name === "commerce"
              ? [
                  "PROVIDER_RERENDER_COST_MINOR",
                  "APPROVAL_WINDOW_SECONDS",
                  "MAX_BUYER_READINGS_PER_BATCH",
                  "AUTO_ARCHIVE_TASKS",
                  "MERCHANT_WEBHOOK_URL",
                  "MERCHANT_WEBHOOK_SECRET",
                ]
              : [];
  for (const key of specific) if (process.env[key]) env[key] = process.env[key];
  return spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    env,
    stdio: "inherit",
    windowsHide: true,
  });
});
function stop() {
  for (const child of children) child.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children)
  child.on("exit", (code) => {
    if (code && code !== 0) {
      stop();
      process.exitCode = code;
    }
  });
