import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const backendRoot = fileURLToPath(new URL("../backend/", import.meta.url));
const run = promisify(execFile);
// Local development only. No signing keys or integration secrets enter the bundle.
// This helper is never mounted by the build or preview commands.
function localSessions() {
  return {
    name: "pvd-local-session",
    configureServer(server) {
      server.middlewares.use("/__local/profile", async (req, res) => {
        const host = req.headers.host?.split(":")[0],
          site = req.headers["sec-fetch-site"];
        if (
          req.method !== "GET" ||
          !["localhost", "127.0.0.1"].includes(host) ||
          (site && site !== "same-origin")
        ) {
          res.writeHead(403);
          res.end();
          return;
        }
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/json");
        try {
          const profile = JSON.parse(
            await readFile(
              new URL("../backend/.local/demo.json", import.meta.url),
              "utf8",
            ),
          );
          res.end(
            JSON.stringify({
              buyers: [{ id: profile.buyer_id, name: "Local test buyer" }],
              environment: "local development",
            }),
          );
        } catch {
          res.writeHead(503);
          res.end(
            JSON.stringify({ message: "Provision the local backend first" }),
          );
        }
      });
      server.middlewares.use("/__local/session", async (req, res) => {
        const host = req.headers.host?.split(":")[0];
        const site = req.headers["sec-fetch-site"];
        const origin = req.headers.origin;
        if (
          req.method !== "POST" ||
          !["localhost", "127.0.0.1"].includes(host) ||
          (site && site !== "same-origin") ||
          (origin && new URL(origin).host !== req.headers.host)
        ) {
          res.writeHead(403);
          res.end();
          return;
        }
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/json");
        try {
          const tokens = await Promise.all(
            ["operator", "buyer"].map(async (role) => {
              const { stdout } = await run(
                process.execPath,
                ["--import", "tsx", "scripts/token.ts", role],
                { cwd: backendRoot, timeout: 15000, windowsHide: true },
              );
              return stdout.trim();
            }),
          );
          res.end(JSON.stringify({ operator: tokens[0], buyer: tokens[1] }));
        } catch {
          res.writeHead(503);
          res.end(
            JSON.stringify({
              message:
                "Local session unavailable. Provision the backend first.",
            }),
          );
        }
      });
    },
  };
}

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    watch: { usePolling: true, interval: 500 },
    host: "127.0.0.1",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
    proxy: {
      "/api/commerce": {
        target: process.env.PVD_COMMERCE_URL || "http://127.0.0.1:4200",
        rewrite: (p) => p.replace(/^\/api\/commerce/, ""),
      },
      "/api/delivery": {
        target: process.env.PVD_DELIVERY_URL || "http://127.0.0.1:4202",
        rewrite: (p) => p.replace(/^\/api\/delivery/, ""),
      },
    },
  },
  plugins: [react(), localSessions()],
});
