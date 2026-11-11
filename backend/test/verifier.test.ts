import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
test("isolated media worker checks real bytes and rejects unauthenticated or corrupt uploads", async () => {
  const secret = randomBytes(32).toString("hex");
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/verifier.ts"],
    {
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        MEDIA_VERIFIER_TOKEN: secret,
        PORT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Verifier startup timeout")),
        60000,
      );
      child.stdout.once("data", (b: Buffer) => {
        clearTimeout(timer);
        resolve((JSON.parse(b.toString()) as { port: number }).port);
      });
      child.once("error", reject);
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Verifier exited before ready"));
      });
    });
    const url = "http://127.0.0.1:" + port + "/verify";
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          body: "x",
          headers: { "content-type": "application/octet-stream" },
        })
      ).status,
      401,
    );
    const headers = {
      authorization: "Bearer " + secret,
      "content-type": "application/octet-stream",
    };
    assert.equal(
      (await fetch(url, { method: "POST", headers, body: "not a video" }))
        .status,
      422,
    );
    const dir = await mkdtemp(join(tmpdir(), "verifier-fixture-"));
    const file = join(dir, "video.mp4");
    execFileSync(
      process.env.FFMPEG_PATH ?? "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=1280x720:r=24",
        "-t",
        "4",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        file,
      ],
      { windowsHide: true, timeout: 20000 },
    );
    const result = await fetch(url, {
      method: "POST",
      headers,
      body: await readFile(file),
    });
    assert.equal(result.status, 200, await result.clone().text());
    const check = (await result.json()) as { height: number; sha256: string };
    assert.equal(check.height, 720);
    assert.match(check.sha256, /^[a-f0-9]{64}$/);
  } finally {
    child.kill();
  }
});
