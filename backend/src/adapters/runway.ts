import type { VideoProvider } from "../core/context.js";
import type { Json } from "../domain/contracts.js";
import { Problem, unavailable } from "../core/errors.js";
export class Runway implements VideoProvider {
  available: boolean;
  constructor(
    private key: string,
    private model: string,
    private network: typeof fetch = fetch,
  ) {
    this.available = !!key;
  }
  private async call(path: string, body?: Json) {
    if (!this.available) throw unavailable("Runway");
    const r = await this.network("https://api.dev.runwayml.com" + path, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: "Bearer " + this.key,
        "X-Runway-Version": "2024-11-06",
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
    if (!r.ok)
      throw new Problem(
        r.status >= 500 ? 503 : 422,
        "provider_rejected",
        "Provider rejected request",
      );
    return (await r.json()) as Json;
  }
  lookup(id: string) {
    return this.call("/v1/tasks/" + encodeURIComponent(id));
  }
  submit(prompt: string) {
    return this.call("/v1/text_to_video", {
      model: this.model,
      promptText: prompt,
      ratio: "1280:720",
      duration: 5,
    });
  }
}
