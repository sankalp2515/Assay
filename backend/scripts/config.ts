import { config } from "dotenv";
config({ path: "../.env", quiet: true });
config({ path: ".env", override: false, quiet: true });
// Root Gemini key is existing user configuration. Backend-only credentials stay in backend/.env.
export const env = process.env;
