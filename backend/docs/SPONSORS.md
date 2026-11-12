# Sponsor technology in Assay

12 November 2026. Each sponsor's technology here does a job a merchant or buyer needs. If it were removed, something real would be lost. Each section says what is built and verified, and what is not.

## KERNEL: proof the buyer can actually play the clip

**The job.** Assay's own buyer-route check downloads the clip from inside Assay's network and compares its SHA-256. That proves the file is served and intact. It does not prove that a real browser on the public internet can open and play it, and that is what a buyer means by "I got it". It is also what a dispute reviewer wants to see.

**What KERNEL does.**

1. After a clip is delivered or recovered, Delivery queues a probe. KERNEL starts a real Chromium in its cloud.
2. The browser opens the site and fetches the clip from the public buyer route with a two-minute token.
3. It hashes the bytes it received and compares them with the archived original.
4. It plays the clip. The session is recorded.

**Where the result goes.**

- The merchant sees the outcome and the replay link.
- The buyer sees the outcome only.
- The dispute evidence package includes it.

**Limits.**

- The probe runs off the money path. Settlement never waits for it or depends on it.
- A failure is recorded as `PROBE_ERROR`, `FETCH_FAILED`, `DIGEST_MISMATCH` or `NOT_PLAYED`. It is never hidden.
- A daily budget (`KERNEL_MAX_PROBES_PER_DAY`) protects the credits.

**Code.** `src/adapters/kernel.ts`, `src/services/playback.ts`, `GET /v1/batches/:id/playback`.

**Verified.**

- **Real KERNEL check** (`npm run check:kernel`, `evidence/kernel-playback.json`): a cloud Chromium fetched a public CC0 H.264 clip, the digest matched, it played to 0.64 s at 960×540, and a replay was recorded.
- **Fixture tests** cover the full flow inside Assay: queueing, budget, buyer and merchant views, dispute evidence, and failures.

- **Hosted Assay clips** (`evidence/hosted-sandbox-run.json`, 12 November): in a full PayPal Sandbox run through the deployed UI, KERNEL probed all 8 delivered clips from the public buyer route. All 8 matched the archived SHA-256 and played at 1280×720.

## Postman: the merchant's runnable integration guide and contract test

**The job.** A merchant integrating Assay needs to try the API in minutes. They also need to know that the rules they rely on hold:

- A retried request returns the first result.
- A changed payload under the same key is refused.
- An automation key can never approve money.
- A buyer token opens one batch only.
- A charge never exceeds the authorization.
- Money is always in the batch currency.

**What Postman does.** `docs/postman/assay-merchant.postman_collection.json` walks through six folders:

| Folder | What it covers |
|---|---|
| 0 | Public: PayPal button configuration and statement keys |
| 1 | Sign up and keys |
| 2 | Open a batch, with the idempotency and scope tests |
| 3 | Buyer approves the PayPal hold |
| 4 | Authorize and settle |
| 5 | Rotate keys |

There are local and hosted-Sandbox environments. `npm run postman:run` runs the collection headless with Newman.

**Verified.**

- Local: all five services on HTTP with fixture PayPal, 23 requests, 21 assertions, 0 failures (`evidence/postman-run.json`).
- Hosted: the same collection against the deployed Sandbox service, 23 requests, 21 assertions, 0 failures (`evidence/postman-hosted-run.json`). Without a human buyer approval in PayPal, the authorize step correctly refuses to claim a hold.

**Not yet done.** Publishing it in a public Postman workspace needs the user's Postman account.

## Bryntum Scheduler: the recovery window, on a timeline

**The job.** Assay is a race against clocks:

- providers deleting output (Replicate 1 hour, Runway 24–48 hours)
- PayPal's 3-day honor period and 29-day authorization
- the batch deadline
- clip retention
- dispute response deadlines

An operator needs to see which clips are close to being lost and which deadlines are near.

**What Bryntum does.** A Scheduler with one row per clip, plus a PayPal row and a disputes row.

- **Facts and estimates look different.** Every event is marked `OBSERVED` (from Assay's records) or `ESTIMATE` (from a provider's published retention or PayPal's honor period).
- **Clips at risk are flagged.** `at_risk_unit_ids` lists clips not yet archived whose provider copy is still alive.

**Built and verified.** `GET /v1/batches/:id/timeline` feeds the Recovery window screen. On the hosted deployment it showed the PayPal row, all ten clips and the deadlines for the 12 November Sandbox run. It runs on Bryntum's hackathon trial licence (valid to 26 December 2026), so Bryntum's own "Trial" badge appears.

## AG Grid / AG Studio: the merchant's operations view

**The job.** One case at a time doesn't scale. A merchant with many batches needs to scan and filter:

- archived but not delivered (act now)
- recovered, and re-render cost avoided
- authorized vs. charged vs. never taken, per currency
- open disputes and their deadlines
- external playback results

**What AG Studio does.** A dashboard over `GET /v1/operations/dashboard` (one row per batch or per clip) and `GET /v1/operations/impact`. If its agent is enabled, it may build and query widgets only. It gets no payment or approval tools, consistent with Assay's rule that AI reads and rules decide.

**Built and verified.** The Dashboard screen renders the hosted 12 November Sandbox run from these endpoints: 10 clips ordered, 8 delivered, 1 recovered, $40.00 charged and $10.00 never taken. It uses an AG Studio trial licence key.

## APIMatic: checking our PayPal calls against PayPal's API definitions

**The job.** Several PayPal calls are tested only against Assay's fixture PayPal:

- partner referrals and merchant integrations
- `PayPal-Auth-Assertion`
- disputes
- non-USD amounts

**What APIMatic does.** The APIMatic Context Plugin for PayPal gives the coding agent PayPal's authoritative API definitions. We will use it to review those calls and fix any mismatch it finds, and say so. It is a contract review of an existing integration. We do not claim the integration was built with it.

**Status.** Waiting for the user to install the plugin.
