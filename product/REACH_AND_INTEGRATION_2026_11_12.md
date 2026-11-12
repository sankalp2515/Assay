# Reach, provider integration and judge-visible video

12 November 2026. This answers three questions from the user, plus what we took from a YouTube Short they shared.

## 1. The YouTube Short: what it shows and what we take from it

**What it is.** A 1 minute 46 second German-language Short from InsiderForce. It covers a hackathon winner (Anthropic × Forum Ventures, New York) who built a product in eight hours with Claude Code and then published his whole setup, "everything-claude-code", for free. The video says it has over 214,000 GitHub stars. The setup is:

- 64 specialized agents, each with one job: planning, architecture, security review, build fixes, code review, end-to-end tests
- 262 skills, 84 slash commands and trigger-based hooks
- preconfigured MCP connections to GitHub, Supabase, Vercel and Railway
- a "continuous learning" loop that turns repeated patterns from git history into reusable skills

It installs as one plugin on any operating system. The video ends with an ebook call-to-action. The Short is about developer tooling, not payments or video. Its lessons are about distribution.

| What made it spread | What it means for Assay | Done |
|---|---|---|
| It installs in one step into the tool developers already use, and works on day one | A merchant's AI coding agent should be able to integrate Assay itself | **Built:** an Assay MCP server (`npm run mcp`, `src/mcp/server.ts`), on top of the `@assay/node` SDK |
| Each agent has one narrow job | Assay's AI is already bounded: it reads buyer messages and investigates; rules decide. This is a judging point, not a weakness | Positioning only |
| Preconfigured connections to the platforms people already use | Connect to video providers directly instead of asking merchants to poll | **Built:** the Replicate connector (below) |
| It learns from your own history | Assay already holds every incident: which provider and which stage lost a clip, and how fast archiving happened. A per-merchant "where you lose clips" report from records (not AI) is a natural next step | Later |
| Free and open, with visible stars | Our repo is public under MIT. Publishing the SDK and MCP server to npm, and listing in MCP directories, is cheap reach | Later (needs the user's npm account) |

What the MCP server gives an agent:

- **Tools:** account, batches list and get, recovery timeline, signed statement, operations dashboard, open a batch, and register a provider task.
- **No money tools.** There is no approve, refund, cancel or key tool. The server runs on an `integration` key, which cannot approve money even through the API.
- **Tested** through a real MCP client.

To add it to Claude Code:

```bash
claude mcp add assay --env ASSAY_API_KEY=assay_sk_… --env ASSAY_BASE_URL=https://<host> -- npx tsx src/mcp/server.ts
```

## 2. "Can Runway use our product?" Yes, and it makes sense

There are two directions. The first works today; the second is a partnership.

**A. A merchant that uses Runway, Replicate or another provider connects Assay (built).** The merchant keeps its provider account and registers each task with Assay (`POST /v1/batches/{id}/tasks`). Until now Assay then polled the provider. New today: the **Replicate connector**.

1. `POST /v1/connect/replicate` gives the merchant a private webhook URL.
2. They pass it as `webhook` when creating each prediction.
3. Replicate calls Assay the moment the render completes. Assay verifies Replicate's Standard Webhooks signature, finds the registered task, and archives immediately.
4. Before anything is downloaded, Assay reads the prediction back with the merchant's own token. It never trusts the webhook body.

This closes the gap that matters most for Replicate, whose outputs are deleted after an hour. Runway's API has no completion webhook today, so Runway tasks stay on polling. fal has signed webhooks and could be next.

**B. A provider offers Assay to its own customers (partnership).** Runway, Replicate or fal could offer "delivery assurance" to their API customers. When a render completes, the provider already knows. Sending that event to Assay on the customer's behalf would mean:

- the output is preserved before the provider's retention runs out
- the customer can prove what was delivered, and charge their end buyer exactly through PayPal
- the provider gets fewer "refund my credits" tickets for renders that actually finished

Technically this is direction A with the provider holding the connection: a per-customer connector token instead of a merchant-configured webhook. It needs a business agreement, not new architecture. For the pitch: "Assay is the delivery-assurance layer any video provider can switch on for its customers."

## 3. How judges see video without generating anything

Judges shouldn't need a GPU, a provider account or a wait. The paths, from no setup to most real:

| Path | What judges see | External dependencies |
|---|---|---|
| Landing page walkthrough (illustrative) | The full story with labeled stills | None |
| `npm run demo` (Docker or Node) | Every step printed, on a locally encoded test MP4 | None: no keys, no network |
| Hosted Sandbox, "Try as merchant" → "Run the demo provider" | Real clips playing in the buyer view, a lost clip, recovery, the timeline and the dashboard | Only PayPal Sandbox, for the hold |
| The video submission | One recorded run, hosted, with a real Sandbox approval | None for the viewer |

**What changed today.**

- The hosted demo provider rotates two real LTX-Video clips (a lighthouse and a beach), both generated on the free public LTX Space today. Each has a provenance file covering the prompt, the model, the one crop that removed a generated caption artifact, and both hashes.
- Clips alternate, so the lost clip looks different from its neighbours.
- The demo provider's response says the clips are pre-generated and reused. Nothing is generated per batch.

**What we don't do.** We don't make judges generate video live. A free public GPU queue is slow and rate-limited: today it refused four requests in a row after three successes. A paid provider would need a key and real money. The product claim is about what happens after generation, so pre-generated real clips are the honest way to show it.
