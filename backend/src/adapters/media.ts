import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { createWriteStream } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { requireThat, Problem } from "../core/errors.js";
export function publicAddress(ip: string) {
  if (ip.includes(":")) return !/^(::|fc|fd|fe[89ab]|ff)/i.test(ip);
  const p = ip.split(".").map(Number);
  const [a, b] = p;
  return (
    p.length === 4 &&
    p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    a !== 0 &&
    a !== 10 &&
    a !== 127 &&
    a! < 224 &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b! >= 16 && b! <= 31) &&
    !(a === 192 && (b === 168 || b === 0)) &&
    !(a === 100 && b! >= 64 && b! <= 127) &&
    !(a === 198 && (b === 18 || b === 19))
  );
}
export async function downloadOutput(
  source: string,
  destination: string,
  hosts: string[],
) {
  const url = new URL(source);
  requireThat(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      hosts.includes(url.hostname),
    "unsafe_output_origin",
    "Provider output origin is not permitted",
    422,
  );
  const addresses = await lookup(url.hostname, { all: true });
  requireThat(
    addresses.length && addresses.every((a) => publicAddress(a.address)),
    "unsafe_output_address",
    "Output resolved to a forbidden address",
    422,
  );
  const selected = addresses[0]!;
  try {
    await new Promise<void>((resolve, reject) => {
      const req = request(
        url,
        {
          family: selected.family,
          lookup: (_name, _options, callback) =>
            callback(null, selected.address, selected.family),
          timeout: 20000,
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            reject(
              new Problem(
                422,
                "output_download_failed",
                "Output did not return a successful direct response",
              ),
            );
            return;
          }
          let bytes = 0;
          const guard = new Transform({
            transform(chunk: Buffer, _encoding, done) {
              bytes += chunk.length;
              done(
                bytes > 25 * 1024 * 1024
                  ? new Error("output_size_exceeded")
                  : null,
                chunk,
              );
            },
          });
          pipeline(
            res,
            guard,
            createWriteStream(destination, { flags: "wx", mode: 0o600 }),
          ).then(() => resolve(), reject);
        },
      );
      req.on("timeout", () => req.destroy(new Error("output_timeout")));
      req.on("error", reject);
      req.end();
    });
  } catch (e) {
    await rm(destination, { force: true });
    throw e;
  }
}
async function run(binary: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, {
      shell: false,
      windowsHide: true,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
      timeout: 15000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => {
      stdout += b.toString();
      if (stdout.length > 100000) child.kill();
    });
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString();
      if (stderr.length > 10000) child.kill();
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error("media_verification_failed")),
    );
  });
}
export async function verifyVideo(path: string) {
  const metadata = JSON.parse(
    await run(process.env.FFPROBE_PATH ?? "ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      path,
    ]),
  ) as {
    streams?: {
      codec_type: string;
      codec_name: string;
      width: number;
      height: number;
    }[];
    format?: { duration: string; format_name: string; size: string };
  };
  const video = metadata.streams?.find((s) => s.codec_type === "video");
  const duration = Number(metadata.format?.duration);
  const bytes = Number(metadata.format?.size);
  requireThat(
    video?.codec_name === "h264" &&
      video.height >= 720 &&
      video.width >= 720 &&
      duration >= 3.75 &&
      duration <= 10.25 &&
      bytes > 0 &&
      bytes <= 25 * 1024 * 1024 &&
      metadata.format?.format_name.includes("mp4"),
    "invalid_media",
    "Output does not satisfy the technical video contract",
    422,
  );
  await run(process.env.FFMPEG_PATH ?? "ffmpeg", [
    "-v",
    "error",
    "-xerror",
    "-protocol_whitelist",
    "file,pipe",
    "-i",
    path,
    "-f",
    "null",
    "-",
  ]);
  const data = await readFile(path);
  return {
    sha256: createHash("sha256").update(data).digest("hex"),
    bytes: data.length,
    duration,
    width: video.width,
    height: video.height,
    codec: "h264",
    checker_version: "media-v1",
  };
}
export async function isolatedVerification(path: string) {
  const endpoint = process.env.MEDIA_VERIFIER_URL;
  if (!endpoint) {
    requireThat(
      process.env.NODE_ENV !== "production",
      "verifier_unavailable",
      "Production requires the isolated verifier worker",
      503,
    );
    return verifyVideo(path);
  }
  const key = process.env.MEDIA_VERIFIER_TOKEN;
  requireThat(
    key,
    "verifier_unavailable",
    "Verifier capability token missing",
    503,
  );
  const bytes = await readFile(path);
  const expected = createHash("sha256").update(bytes).digest("hex");
  const response = await fetch(new URL("/verify", endpoint), {
    method: "POST",
    headers: {
      authorization: "Bearer " + key,
      "content-type": "application/octet-stream",
    },
    body: bytes,
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  requireThat(
    response.ok,
    "invalid_media",
    "Isolated verifier rejected output",
    422,
  );
  const result = (await response.json()) as Awaited<
    ReturnType<typeof verifyVideo>
  >;
  requireThat(
    result.sha256 === expected && result.bytes === bytes.length,
    "verifier_mismatch",
    "Verifier returned mismatched bytes",
    502,
  );
  return result;
}
