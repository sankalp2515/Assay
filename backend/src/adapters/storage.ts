import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { googleAccessToken } from "./google.js";

// Where archived originals live. The local store keeps one file per artifact on a
// private volume (development, single-host Docker). The GCS store keeps them in a
// private Google Cloud Storage bucket so Cloud Run instances can be replaced freely.
// Either way the file is written once, never overwritten, and its SHA-256 is checked on
// every read by the caller.
export interface BlobStore {
  name: "local" | "gcs";
  // Takes ownership of a verified local file.
  put(key: string, localPath: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export class LocalStore implements BlobStore {
  name = "local" as const;
  constructor(private dir: string) {}
  path(key: string) {
    return join(this.dir, key + ".mp4");
  }
  async put(key: string, localPath: string) {
    if (localPath !== this.path(key)) throw new Error("Local store expects files in place");
  }
  get(key: string) {
    return readFile(this.path(key));
  }
  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }
}

export class GcsStore implements BlobStore {
  name = "gcs" as const;
  constructor(
    private bucket: string,
    private prefix = "artifacts/",
    private network: typeof fetch = fetch,
    private token: () => Promise<string> = () => googleAccessToken(),
  ) {
    if (!/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("Invalid GCS bucket name");
  }
  private object(key: string) {
    if (!/^[0-9a-f-]{36}$/.test(key)) throw new Error("Invalid artifact key");
    return this.prefix + key + ".mp4";
  }
  private async call(url: string, init: RequestInit = {}) {
    const r = await this.network(url, {
      ...init,
      headers: { authorization: "Bearer " + (await this.token()), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(60000),
      redirect: "error",
    });
    return r;
  }
  async put(key: string, localPath: string) {
    const bytes = await readFile(localPath);
    // ifGenerationMatch=0: create only; an existing original is never replaced.
    const r = await this.call(
      `https://storage.googleapis.com/upload/storage/v1/b/${this.bucket}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent(this.object(key))}`,
      { method: "POST", headers: { "content-type": "video/mp4" }, body: bytes },
    );
    if (!r.ok && r.status !== 412) throw new Error("GCS upload failed: " + r.status);
    await rm(localPath, { force: true });
  }
  async get(key: string) {
    const r = await this.call(
      `https://storage.googleapis.com/storage/v1/b/${this.bucket}/o/${encodeURIComponent(this.object(key))}?alt=media`,
    );
    if (!r.ok) throw new Error("GCS read failed: " + r.status);
    return Buffer.from(await r.arrayBuffer());
  }
  async remove(key: string) {
    const r = await this.call(
      `https://storage.googleapis.com/storage/v1/b/${this.bucket}/o/${encodeURIComponent(this.object(key))}`,
      { method: "DELETE" },
    );
    if (!r.ok && r.status !== 404) throw new Error("GCS delete failed: " + r.status);
  }
}

export function configuredStore(artifactDir: string, env = process.env): BlobStore {
  if (env.ARTIFACT_STORE === "gcs") {
    if (!env.GCS_BUCKET) throw new Error("ARTIFACT_STORE=gcs requires GCS_BUCKET");
    return new GcsStore(env.GCS_BUCKET, env.GCS_PREFIX ?? "artifacts/");
  }
  return new LocalStore(artifactDir);
}
