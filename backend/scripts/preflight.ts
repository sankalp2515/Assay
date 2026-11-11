import "./config.js";
import { env } from "./config.js";
const groups = {
  paypal: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_MERCHANT_ID"],
  gemini: ["GEMINI_API_KEY"],
  groq: ["GROQ_API_KEY"],
  nvidia: ["NVIDIA_API_KEY"],
  video: ["RUNWAY_API_KEY"],
  webhooks: ["PAYPAL_WEBHOOK_ID"],
  elastic: ["ELASTICSEARCH_URL", "ELASTICSEARCH_API_KEY"],
};
console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(groups).map(([k, keys]) => [
        k,
        {
          configured: keys.every((key) => !!env[key]),
          missing: keys.filter((key) => !env[key]),
        },
      ]),
    ),
    null,
    2,
  ),
);
