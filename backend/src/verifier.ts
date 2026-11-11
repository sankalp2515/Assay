import { logOptions } from "./core/logging.js";
import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import { mkdtemp, writeFile, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyVideo } from "./adapters/media.js";
const secret = process.env.MEDIA_VERIFIER_TOKEN;
if (!secret || secret.length < 32)
  throw new Error(
    "A private verifier capability token of at least 32 characters is required",
  );
const app = Fastify({
  bodyLimit: 25 * 1024 * 1024,
  requestTimeout: 30000,
  logger: logOptions("verifier", process.env.NODE_ENV === "production"),
});
app.addContentTypeParser(
  "application/octet-stream",
  { parseAs: "buffer" },
  (_req, body, done) => done(null, body),
);
let busy = false;
app.get("/health", async () => ({
  status: "alive",
  worker: "isolated-media-verifier",
}));
app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/health") return;
  const supplied = Buffer.from(req.headers.authorization ?? "");
  const expected = Buffer.from("Bearer " + secret);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return reply.code(401).send({ code: "unauthorized" });
});
app.post("/verify", async (req, reply) => {
  if (busy) return reply.code(429).send({ code: "verifier_busy" });
  busy = true;
  const dir = await mkdtemp(join(tmpdir(), "media-check-"));
  const path = join(dir, "input.mp4");
  try {
    await writeFile(path, req.body as Buffer, { mode: 0o600 });
    return await verifyVideo(path);
  } catch {
    return reply.code(422).send({ code: "invalid_media" });
  } finally {
    await rm(path, { force: true });
    await rmdir(dir);
    busy = false;
  }
});
await app.listen({
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 4105),
});
console.log(
  JSON.stringify({
    worker: "media-verifier",
    port: (app.server.address() as { port: number }).port,
  }),
);
