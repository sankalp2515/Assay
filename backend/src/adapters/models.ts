import { GeminiInvestigator } from "./gemini.js";
import type { Model } from "../core/context.js";
import type { Evidence, Json } from "../domain/contracts.js";
import { unavailable } from "../core/errors.js";

export class HostedInvestigator extends GeminiInvestigator {
  constructor(
    private provider: "groq" | "nvidia",
    private hostedKey: string,
    private modelName: string,
    private networkCall: typeof fetch = fetch,
  ) {
    super(hostedKey, provider + "/" + modelName);
  }
  protected override async generate(
    instruction: string,
    evidence: Evidence[],
    schema: Json,
  ) {
    const endpoint =
      this.provider === "groq"
        ? "https://api.groq.com/openai/v1/chat/completions"
        : "https://integrate.api.nvidia.com/v1/chat/completions";
    const response = await this.networkCall(endpoint, {
      method: "POST",
      headers: {
        authorization: "Bearer " + this.hostedKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.modelName,
        stream: false,
        temperature: 0,
        max_tokens: 2500,
        messages: [
          {
            role: "system",
            content:
              instruction +
              " Return only a JSON object matching this schema: " +
              JSON.stringify(schema),
          },
          { role: "user", content: JSON.stringify({ evidence }) },
        ],
        ...(this.provider === "groq"
          ? { response_format: { type: "json_object" } }
          : { chat_template_kwargs: { enable_thinking: false } }),
      }),
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
    if (!response.ok) throw unavailable(this.provider);
    const result = (await response.json()) as {
      choices?: { finish_reason?: string; message?: { content?: string } }[];
    };
    const choice = result.choices?.[0];
    if (choice?.finish_reason !== "stop" || !choice.message?.content)
      throw unavailable(this.provider);
    return JSON.parse(choice.message.content) as unknown;
  }
}
export class InvestigatorChain implements Model {
  available: boolean;
  constructor(private candidates: { name: string; model: Model }[]) {
    this.available = candidates.some((c) => c.model.available);
    if (candidates.length > 3)
      throw new Error("At most three AI providers are allowed");
  }
  async assess(
    evidence: Evidence[],
    read?: (unit: string) => Promise<Evidence[]>,
  ) {
    const attempts: { provider: string; outcome: string }[] = [];
    const cache = new Map<string, Promise<Evidence[]>>();
    const scopedRead = read
      ? async (unit: string) => {
          if (!cache.has(unit)) {
            if (cache.size >= 3) throw unavailable("AI tool budget");
            cache.set(unit, read(unit));
          }
          return cache.get(unit)!;
        }
      : undefined;
    for (const candidate of this.candidates) {
      if (!candidate.model.available) continue;
      try {
        const result = await candidate.model.assess(evidence, scopedRead);
        // INCONCLUSIVE is valid uncertainty, never a reason to shop for a permissive model.
        attempts.push({ provider: candidate.name, outcome: "accepted" });
        return { ...result, attempted_models: attempts };
      } catch {
        attempts.push({
          provider: candidate.name,
          outcome: "unavailable_or_invalid",
        });
      }
    }
    throw unavailable("All configured AI investigators");
  }
  async interpret(message: string, clipCount: number) {
    const attempts: { provider: string; outcome: string }[] = [];
    for (const candidate of this.candidates) {
      if (!candidate.model.available || !candidate.model.interpret) continue;
      try {
        const result = await candidate.model.interpret(message, clipCount);
        attempts.push({ provider: candidate.name, outcome: "accepted" });
        return { ...result, attempted_models: attempts };
      } catch {
        attempts.push({
          provider: candidate.name,
          outcome: "unavailable_or_invalid",
        });
      }
    }
    throw unavailable("All configured AI readers");
  }
}
export function configuredInvestigator(env: NodeJS.ProcessEnv): Model {
  const permittedKey = (provider: string, value: string | undefined) =>
    env.AI_ZERO_COST_ONLY !== "false" &&
    env[provider.toUpperCase() + "_FREE_TIER_CONFIRMED"] !== "true"
      ? ""
      : (value ?? "");
  const candidates = [
    {
      name: "gemini",
      model: new GeminiInvestigator(
        permittedKey("gemini", env.GEMINI_API_KEY),
        env.GEMINI_MODEL ?? "gemini-3.1-flash-lite",
        fetch,
        30000,
      ),
    },
  ];
  const requested = (env.AI_FALLBACK_PROVIDERS ?? "groq,nvidia")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (
    new Set(requested).size !== requested.length ||
    requested.some((p) => !["groq", "nvidia"].includes(p))
  )
    throw new Error(
      "AI_FALLBACK_PROVIDERS must list groq,nvidia without duplicates",
    );
  for (const provider of requested) {
    const model =
      provider === "groq"
        ? new HostedInvestigator(
            "groq",
            permittedKey("groq", env.GROQ_API_KEY),
            env.GROQ_MODEL ?? "openai/gpt-oss-120b",
          )
        : new HostedInvestigator(
            "nvidia",
            permittedKey("nvidia", env.NVIDIA_API_KEY),
            env.NVIDIA_MODEL ?? "nvidia/nemotron-3.5-super-vl-120b-a12b",
          );
    candidates.push({ name: provider, model });
  }
  return new InvestigatorChain(candidates);
}
