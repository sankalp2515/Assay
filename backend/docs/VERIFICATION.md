# Backend verification and remaining gates

**Current status, 11 November 2026.** The sections below are dated history; where numbers differ, this block wins.

- `npm run verify:local`: 49/49 tests, 9 native PostgreSQL checks, build and OpenAPI all pass.
- Container smoke: 11 healthy containers. Signed calls reach all five services, and the Investigation container returns a real Gemini reading. The new task intake refuses an unauthorized batch, and batch views carry recovered clips.
- Buyer-message reading: Gemini 25/30 vs keyword baseline 15/30 on 30 authored messages. Single run.
- Real PayPal Sandbox: authorize, $40 final capture, refund and void at adapter level, plus one service-level $40 capture. The per-clip `note_to_payer`, merchant webhooks and Replicate lookups are fixture-tested only.

8 November 2026 · Evidence categories are intentionally distinct

| Check | Evidence / current result |
| --- | --- |
| Strict TypeScript and build | Passed during implementation, final rerun recorded below |
| Domain/API/database/failure tests | Final full run: 35 passed, zero failed, including isolated verifier and persistent dispatch pause. |
| Separate local services | Five processes on ports 4100–4104; HTTP readiness/auth/create/replay/conflict smoke passed, including committed record persistence across restart |
| Postman tooling | Newman 6.2.1 executed two local requests and four assertions, all passed. Redacted summary generated from private report. |
| Actual Gemini connectivity | evidence/gemini-connectivity.json: actual request with synthetic evidence, supported citations |
| Actual Gemini recovery workflow | evidence/real-ai-fixture-workflow.json: real model and one selected provider read, locally generated MP4 and fixture PayPal settlement |
| Media worker | Separate process accepted real valid MP4 and rejected corrupt/unauthenticated bytes |
| Local performance | 50 authenticated empty-list requests, p50 about 5.48 ms/p95 about 7.52 ms in injection + embedded PostgreSQL. Not distributed capacity evidence. |
| Backend dependency audit | Zero reported vulnerabilities at review time |
| Compose | Secret-preserving config validation passed. Engine/container build/start unverified. |
| Actual PayPal Sandbox authentication | Passed against the real Sandbox OAuth endpoint; existing app credentials saved privately. evidence/paypal-authentication.json |
| Actual PayPal Sandbox lifecycle | Passed at adapter level: real buyer approvals, $50 authorization, $40 final capture, $5 refund linked to its original capture and separate authorization/void. Original India merchant currency rejection was resolved with an approved US test app. Full combined provider/service journey and actual signed webhook delivery remain open. evidence/paypal-lifecycle.json Authentication alone does not pass this gate. |
| Actual video generation and recovery | One original LTX Video Distilled clip generated on public ZeroGPU. Independent verifier decoded it. Actual Gemini supported recovery and the buyer received byte-identical media. This combined run used fixture payment. See `evidence/generated-video-fixture-paypal.json`. Runway access remains unconfigured. |
| Cloud deployment | Google Cloud selected for deployment; no cloud resources deployed |
| AI decision evaluation | Actual Gemini scored 17/20 on a frozen synthetic action set. Competent deterministic baseline scored 20/20. Zero unsupported restores. Operator-time, semantic citation scoring and merchant benefit remain unmeasured. |

## Test scope

Tests use five separate embedded PostgreSQL engines and authenticated Fastify API calls. They exercise data constraints, state transitions, tenant RLS, financial bounds, stale evidence, permit/cancel races, idempotency, pending and unknown payment handling, AI/PayPal absence, original fixture recovery, media checks and provider submission uncertainty. The service-process smoke additionally uses actual localhost HTTP. Embedded PostgreSQL serializes differently from a real multi-client server; Native PostgreSQL 18.6 now separately passes nine checks for pooled concurrency, restricted-role RLS, money bounds, lease fencing, encrypted logical restore and restart durability. Distributed capacity and complete media/cross-service recovery remain unverified.

Fixture PayPal/model/provider responses are never actual sandbox receipts. A real locally created H.264 file proves byte validation and scoped retrieval, not original provider generation. The actual-model fixture workflow demonstrates integration and selected read tools, not market validation or a held-out AI benefit.

## Commercial go/no-go

Normal case closure requires both valid AI assessment and confirmed PayPal state. Production expansion also needs verified merchant authority, actual provider/Sandbox receipts, externally authenticated users, restore and isolation tests, support ownership, retention/permissions review, shared media storage for scale and measured incremental operator value. Frontend remains outside this task.


## Latest reproducible local run

`npm run verify:local`: strict typing, 35 tests/zero failures, nine native PostgreSQL checks, build and OpenAPI export passed. evidence/local-quality.json and evidence/native-postgres.json record the actual result. It made no external API calls. Tests include forged/duplicate webhooks beyond the first hundred operations, operator diagnostics, service-key overlap/retirement, hosted-provider fallback/citation validation and free-tier admission. Groq/NVIDIA responses are mocks in the local test suite; separate actual API checks now passed for all three providers in evidence/ai-providers.json. Gemini remains primary; no local model is used. A key alone is insufficient for zero-cost admission.

The native encrypted database restore rejects tampered ciphertext and nonempty targets, restores fixture journal/balance/queue records and resumes the audit sequence. It is not media backup, PITR or a measured disaster RPO/RTO. Actual Sandbox adapter authorization/capture/refund/void passed in evidence/paypal-lifecycle.json; a combined actual-provider product workflow and callback delivery remain separate gates. No live financial operation or cloud resource was provisioned.


The final adapter review also binds capture/void resource IDs and validates refund up-links against the exact original capture on allowed Sandbox hosts. Actual Sandbox refund read-back passed that association check. Public approval/cancel return routes are informational, perform no writes and do not reflect query identifiers. Tests verify that a redirect alone cannot establish payment.


Combined integration gate passed (backend/evidence/service-sandbox-workflow.json): actual Gemini, actual Sandbox buyer approval/authorization and one confirmed $40 capture from the same $50 authorization through the five domain APIs. The original locally generated fixture file was recovered, eight purchaser routes were verified, and one capture journal entry persisted. This test uses authenticated in-process Fastify calls, five persistent PGlite databases, eight fixture MP4s and two fixture failed tasks. It does not establish actual video-provider output, separate-process HTTP e2e, signed callback delivery or commercial production readiness. The initial conservative AI action and reassessment retry failure were fixed without relaxing evidence/money gates or creating a replacement authorization. Explicit refresh_reason preserves the prior investigation; stable observation IDs preserve retry payload identity. The final local suite now passes 35 tests, plus nine native PostgreSQL checks. Frontend and cloud deployment remain excluded/unexecuted.

Payment concurrency follow-up: reconciliation leaves undispatched reservations alone and preserves a confirmation recorded by another worker. Delayed pending responses and dispatch errors cannot roll back confirmed settlement. Concurrent maintenance workers recheck the reconciliation cooldown while holding the operation row lock. A fixture test delays a pending PayPal response, confirms through a second read, then releases the stale response and verifies one capture call and one journal entry.


## Frontend handoff and no-cost video proof

The localhost recovery fixture passed an HTTP smoke covering operator review, durable asynchronous AI adoption, private buyer retrieval and outbox settlement. The fixture uses synthetic media, a fixture model and a fixture payment adapter. See [frontend handoff](FRONTEND_HANDOFF.md) and `evidence/frontend-fixtures-smoke.json`.

The actual LTX clip was generated through the public Lightricks ZeroGPU demo, then downloaded from its completed Gradio result. The 4.03-second 1280×736 H.264 file passed decode and hash verification through a separate loopback verifier process. The integration harness used a fixed result bridge, then called the normal attempt, preserve, investigate, restore, buyer content and closure routes. No second generation was submitted for that result. The original, archive and buyer bytes matched. This proves recovery of actual AI-generated output under test conditions. The standard service runtime still uses the Runway adapter.

The actual-media plus actual-Sandbox run uses a separate test order and requires buyer approval. The prior $50 to $40 Sandbox run used fixture media. Actual signed PayPal delivery requires an externally reachable HTTPS listener and configured app webhook. The local suite covers forged and duplicate callbacks with fixtures.

The automated synthetic evaluation is reproducible with `npm run evaluate:investigation`. It used a frozen 20-case manifest, identical normalized facts and no payment writes. Gemini missed two actions and one case failed provider or schema validation. It missed an expired artifact escalation and proposed lookup when no task ID existed. The report contains per-case results. The accuracy advantage and operator-time gate remain unearned.

## Frontend completion and web boundary — 10 November

Added the cookie-session web gateway under src/web. It serves built SPA assets and allowlisted same-origin Commerce/private-media routes, validates OIDC code/PKCE/nonce/issuer/audience, maps verified subjects to provisioned membership and derives internal authority server-side. Browser bearer headers cannot elevate role. Secure HttpOnly cookies, CSRF/origin checks and session revocation protect writes. Development helper remains loopback-only and is absent from production assets. Production requires a separate PostgreSQL web store, migration credentials, external OIDC configuration and service access; external identity login has not been executed.

Added safe environment/readiness, aggregate operation health, batch financial/activity projections, original-task lookup and retained support cases. Normal refunds require an exact expiring review tied to capture, allocation, amount and assessment, validated while reserving funds atomically; same-key replay returns the original reservation. Review metadata contains no credentials or provider signed URLs. Existing financial invariants remain authoritative.

Validation: strict typecheck passed. Latest full backend suite had 38/39 pass: media-worker process startup exceeded its 15-second test deadline during concurrent build/test load. The failed test rerun alone passed in 1.75 seconds. Earlier full 39-test pass remains historical, not the latest uninterrupted result. Frontend 11 domain tests and four hosting-worker tests passed; production build passed before the final visual review changes and is rerun after them. Hosted Gemini returned cited findings over synthetic provider observations; browser recovery increased published clips seven to eight. This is not actual provider output or a new actual PayPal checkout receipt.

Focused refund-eligibility follow-up passed 2/2 experience tests after strict typecheck: a three-unit batch with only two captured units exposes only those two; a reserved/refunded unit is excluded from further selection. One initial test command was launched from the workspace root and failed locating migrations; rerun from backend/ passed. Production frontend build passed after final changes. Built client scan found no localhost helper paths or development display controls.

## Recovery-first differentiators, 10 November

**Local gate.** `npm run verify:local` passed:

- strict typecheck
- **43/43 tests**, with zero failures in one uninterrupted run
- native PostgreSQL checks
- build
- OpenAPI export

The verifier startup deadline was raised from 15 s to 60 s, so the earlier 38/39 timeout is resolved. New tests in `test/differentiators.test.ts` cover:

- quotes must come from the buyer's message
- rule-only outcomes
- the full recovery story, from buyer message to restored original to one $40 capture
- the capture's `invoice_id` and `note_to_payer`
- statement signing and verification, and tamper rejection
- a statement can't be used as a bearer token
- the impact ledger
- buyer messages kept while AI is down

**Buyer-message reading vs the keyword baseline** (`evidence/claim-reading-evaluation.json`). This was actual Gemini over 30 authored held-out messages; the expected readings and baseline were frozen before the model run.

| Arm | Exact score, all 30 | Exact score, 23 cases Gemini answered |
|---|---|---|
| Gemini | 18/30 | 18/23 |
| Keyword baseline | 15/30 | 11/23 |

- Exact scoring means the (clip, issue) set and the instruction flag must both match.
- Gemini was unavailable for 7 cases: Google returned 503 "high demand" through four retries. Those 7 count as wrong in the all-30 score.
- Gemini produced zero invalid readings.
- Gemini's misses:
  - listing all ten clips where the frozen key expects "whole order" (M06, M09)
  - no claim for an injection-only refund demand (M10)
  - an inverted "every clip except" (M27, which the baseline also missed)
  - extra OTHER claims (M30)
- An earlier same-day run was interrupted by the same provider outage (16/30 with 11 errors) and is superseded.
- This is a single run, with no variance estimate. The messages are authored, not real tickets.
- The model only reads. Outcomes are decided by rules and aren't part of this score.

**Demo.** `npm run demo` passed in fixture mode. `npm run demo -- --real-ai` passed with actual Gemini for the reading and the investigation; PayPal and media were fixtures.

**Not yet in real Sandbox:** the new capture `note_to_payer` and `invoice_id` fields. They are fixture-tested only. The next real Sandbox capture should confirm that PayPal accepts and displays them.

## 11 November hardening

**Local gate.** `npm run verify:local` passed: strict typecheck, **45/45 tests**, native PostgreSQL checks, build and OpenAPI export. The new tests cover the per-order AI reading cap and redaction of request logs (no query strings, headers or tokens).

**Containers.** The Dockerfile now has `runtime` and `demo` targets and a liveness `HEALTHCHECK`. Compose has a project name and `/ready` health checks, and `infra/compose.demo.yaml` runs the walkthrough with no network. `docker compose config` validates both files. After Docker Desktop was restarted, both were **built and run on the development machine**:

- The demo container ran the whole walkthrough with `network_mode: none`.
- The full topology came up with all 11 containers healthy: five services, five PostgreSQL 18 databases and the verifier.
- `npm run smoke:containers` (`evidence/container-smoke.json`) passed against it:
  - authenticated create, idempotent replay and conflict
  - Commerce calling the Provider, Delivery, Payments and Investigation containers with signed service tokens
  - a real Gemini reading of a buyer message served by the Investigation container
  - the public statement key
  - 401 without a token, and 404 for another tenant
- Container logs were JSON with paths only. A scan found no bearer tokens, keys or secrets.

Two faults surfaced only in containers, and both are fixed:

1. The provisioning script wrote JSON values in a quoting style that Docker Compose reads differently from dotenv, so every service received a corrupted public-key list and crash-looped. Values containing quotes are now written single-quoted, the derived key list is rebuilt on each run, and private keys are checked to decode as PEMs. Existing credentials were preserved, not rotated.
2. Compose now uses fixed, overridable subnets (`PVD_SUBNET`, `PVD_VERIFIER_SUBNET`), because hosts with many Docker projects exhaust the default address pools. Host ports are overridable too (`COMMERCE_HOST_PORT`, `DELIVERY_HOST_PORT`, `PAYMENTS_HOST_PORT`).

No PayPal order or paid generation was made in the container run. The CI template now builds the image, checks it runs as non-root, validates compose and runs the demo container.
