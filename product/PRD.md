# Product requirements — Paid video delivery

Version 1.1 · 8 November 2026 · Status: backend microservice implementation; actual integration gates pending; frontend excluded from current task

Owner: product lead. Engineering, design and finance reviewers to be assigned at implementation. Canonical decision: [DISCOVERY.md](DISCOVERY.md). Canonical controls: [ARCHITECTURE.md](ARCHITECTURE.md). Delivery tickets: [BACKLOG.md](BACKLOG.md).

## 1. Executive summary

Independent AI-video merchants lose customer trust when job status, usable files and payment records disagree. This module investigates ambiguous failures, recovers existing output, verifies technical delivery and settles an agreed short batch through PayPal. Buyers authorize a ceiling and pay for verified, purchaser-retrievable units under explicit terms. AI helps investigate messy operational evidence, while deterministic checks and merchant approval govern money. The first release supports one merchant, USD and one provider, with adoption and AI benefit still to be measured.

## 2. Problem statement

An operator receives “I paid but there is no video.” A provider may have completed a render while its callback was lost, a temporary URL may have expired, or generation may genuinely have failed. Re-running can incur another provider charge. A billing ledger does not establish that the correct buyer can retrieve a valid file, and a support explanation does not reconcile payment.

Public reports describe missing exports and credits deducted around failures. Runway already returns credits for provider errors, and HeyGen states failed/canceled videos are not charged. Our opportunity therefore depends on gaps across an independent merchant's provider, storage, delivery and PayPal records. Reports are allegations and purposive samples, without incidence estimates. Runway documents 24–48 hour output URL expiry and expects developers to copy outputs. [Source register](SOURCES.md)

### Target job

When a purchased video appears missing, help the merchant determine what actually exists, deliver recoverable work and close the correct payment amount with a traceable explanation. This is a merchant integration, not an overlay that can modify another vendor's credits.

### Scope and exclusions

P0: one merchant-owned PayPal account, one actual provider adapter, direct batch contracts, 1–10 short clips, USD, reviewed settlement and refunds. Ready and retrievable in the authenticated buyer account is the billable condition. The merchant supplies outputs before capture and bears unpaid-delivery/capture-failure risk. Creative satisfaction is outside technical verification. Subjective complaints remain visible for support review.

P1 prepaid credit repair uses a separate model and journal. A contract has exactly one billing model. Marketplace funds, payouts, consumer wallets, regulated escrow, arbitrary bill payment and autonomous dispute adjudication are excluded. No claim is made that every complaint is recoverable or that PayPal will adopt this product.

## 3. Goals and success metrics

All numerical thresholds below are proposed gates, not observed results. Controlled fixtures establish correctness, not commercial demand.

| Goal | Definition and measurement | Release or pilot target |
| --- | --- | --- |
| Correct collection | Captured amount equals frozen eligible-unit sum, with matching payee/currency | 100% of release fixtures; zero overcollection |
| Preserve money invariants | No duplicate capture, no duplicate unit settlement, confirmed plus pending refunds <= capture | Zero violations under replay/race tests |
| Recover before regeneration | Recoverable existing artifacts recovered without new paid generation / eligible recoverable fixtures | 100% on declared fixture set |
| Evidence quality | Supported material model claims / all material claims, independently labeled | >=95%; abstain on every unsupported monetary action |
| AI contribution | Median operator investigation time versus a competent polling/archive/rules baseline, same held-out cases | >=20% reduction without correctness regression; otherwise narrow claims |
| Delivery integrity | Purchaser route checks pass for each billable output and planned retention | 100% before eligibility; monitor continuously after settlement |
| Operational readiness | Restore rehearsal and unknown-write reconciliation complete | RPO <=15 min, RTO <=4 h target |
| Merchant adoption | Activated shadow pilots and retained use after four weeks | Two pilots and one retained operator before expanding providers |
| Commercial value | Support minutes and repeat inference avoided, minus integration and running costs | Positive measured contribution margin per pilot |

Instrumentation separates provider cost, buyer liability, pending operations, collected cash and confirmed refunds. Do not count unused authorizations as refunded money. Recovery value is not the sum of every generated file's sale price.

## 4. Personas

| Persona | Need and authority | Success |
| --- | --- | --- |
| Merchant operator | Understand incident and approve exact settlement or remedy; no raw secret access | Defensible closure with less investigation effort |
| Purchaser | See terms, files, amount and honest status; access own batch only | Retrieve purchased output and understand excluded units |
| Merchant engineer | Connect provider/payment records, diagnose failures, operate recovery | Bounded retries, reproducible evidence and reconcilable journals |

## 5. Functional requirements

Six of sixteen requirements are P0. Their acceptance criteria include mandatory financial, privacy and operational controls. P1 and P2 are expansion, not omitted P0 safeguards.

> Status, 10 November 2026: a ticked box is implemented and covered by local tests or Sandbox evidence in `backend/docs/VERIFICATION.md`. Unticked boxes are still open. P1/P2 items are expansion and intentionally not built.

### FR-01 — Contract and authorization · P0

As a buyer, I accept a concrete delivery agreement before inference begins. Dependencies: merchant identity and credentials, provider capability check.

- [x] Persist immutable contract version, unit count, integer USD unit price, ceiling, technical criteria, 30-minute proposed completion deadline, seven-day retention and remedy terms.
- [ ] Reject unsupported provider criteria before buyer approval. Explain provider cost risk to the merchant.
- [x] Record buyer consent and contract digest. Create PayPal AUTHORIZE order, obtain buyer approval and confirm authorization before starting paid work.
- [x] Bind merchant, buyer, currency, amount and authorization. A duplicate browser submission resumes the same logical operation.
- [ ] Buyer can see that a temporary authorization is not a completed charge. Declined or expired authorization stops inference.

### FR-02 — Job recovery and private delivery · P0

As an operator, I recover existing work before paying for another attempt. Dependencies: FR-01 and one supported provider adapter.

- [x] Track logical unit independently from all provider attempts and costs. Poll documented task/result endpoints after callback loss.
- [x] Copy usable provider bytes to private versioned storage within provider URL lifetime, retaining a content digest and origin evidence.
- [x] Never blind-retry an ambiguous job submission without supported idempotency or task correlation. Expose submission_unknown for review.
- [x] Validate actual media in an isolated resource-limited process and exercise the authenticated purchaser route. Check decode, format, duration, dimensions, size, unit and buyer binding.
- [x] Quarantine unsupported or mismatched bytes. Failed or stale verification cannot create billable eligibility.
- [x] Deliver eligible units in the buyer account while authorized. Buyer route checks use the same access policy as customer delivery; admin access alone is insufficient.

### FR-03 — AI evidence investigation · P0

As an operator, I receive a cited explanation and useful next read actions. Dependencies: FR-02 observations and redaction.

- [x] Produce schema-valid hypotheses, cited observation IDs, uncertainty, recommended permitted action and reasons for abstention.
- [x] Read only allowlisted, tenant-scoped tools. Never provide financial secrets, raw signed URLs or write capabilities to the model.
- [x] Treat prompts in logs, provider text and customer messages as untrusted evidence. Unsupported citations fail validation.
- [x] Fixed output/tool/daily assessment limits and timeout pause normal assessment-dependent completion. No rules-only normal closure. Reconciliation, preservation, reads and explicit safe release remain available during AI outage.
- [x] Show facts separately from inferences. Price, eligibility, payment amount and approval authority remain outside the model.

### FR-04 — Reviewed final settlement · P0

As a merchant, I collect exactly the agreed verified amount once. Dependencies: FR-01–03, eligibility receipts and payment operation journal.

- [x] Freeze batch eligibility at closure or deadline. Compute amount server-side from the accepted contract and unallocated verified units.
- [x] Bind approval to contract, batch version, unit set, artifact digests, amount, currency, action and expiry. Any change invalidates it.
- [x] For eight eligible $5 units from a ten-unit $50 contract, perform one final $40 authorization capture. Zero eligible units voids the authorization.
- [x] Set final_capture explicitly, confirm partial-capture enablement on the merchant account, verify documented endpoint eligibility, and confirm child capture status, amount, currency and merchant before showing paid.
- [x] Reserve each operation and unit allocation atomically. Duplicate callbacks, repeated clicks and concurrent workers do not duplicate effects.
- [x] Capture timeout becomes unknown, then reconcile the original request and PayPal resource. Do not create a replacement key to escape uncertainty.
- [x] Cancellation and settlement serialize on the same batch. Excluded late output is never retroactively charged.

### FR-05 — Remedies and reconciliation · P0

As an operator, I can restore access and apply an eligible approved remedy without duplicate compensation. Dependencies: FR-02 and FR-04.

- [x] Prefer restoring the correct stored output after a delivery incident. Record remedy type and evidence.
- [x] Permit reviewed partial/full refunds against the original confirmed capture under merchant policy. Atomically reserve pending refunds and per-unit remedy allocations.
- [x] Confirmed plus pending refund total cannot exceed the capture; refunded unit cannot also receive a mutually exclusive credit remedy.
- [x] Pending, failed and unknown refunds have distinct states. Customer sees a confirmed refund only after provider evidence.
- [ ] Verify callback authenticity, persist inbox, deduplicate, tolerate out-of-order events and perform read-back before authoritative financial state changes. (Open: signature verification and dedupe are implemented and fixture-tested; real signed PayPal delivery needs a public HTTPS listener.)
- [ ] A scheduled reconciler resolves outstanding authorizations/captures/refunds, alerts on drift and preserves correction history. (Partly: reconciliation and maintenance workers exist; external drift alerting is not configured.)

### FR-06 — Safe operating workspace · P0

As an operator and buyer, I can use a trustworthy, accessible service. Dependencies: all P0 paths.

- [ ] Merchant roles separate reviewer, engineer and credentialed executor. Buyer routes are scoped to purchaser and contract; cross-tenant lookups return no private data.
- [x] Tenant-scoped composite keys, transactional tenant context and forced RLS defend database paths. Runtime role is not table owner and has no bypass privilege.
- [x] Each service owns its database and durable outbox/inbox. A persisted saga, claimable authority and local financial reservations coordinate work without a distributed transaction or guessed external results.
- [ ] UI supports keyboard review, readable focus/status, mobile layout, error recovery and empty/loading/unknown states. No optimistic paid labels.
- [ ] Encrypt transport and managed storage; redact diagnostics; rotate secrets; expire artifacts according to consent while retaining minimal policy-required financial records.
- [ ] Dashboards, runbooks, audit export, dead-letter handling, budget limits, tested restore and kill switches exist before financial pilot.

### FR-07 — Prepaid merchant adapter · P1

As a prepaid operator, I reconcile delivery with my own credit ledger. Dependencies: proven direct model and explicit adapter contract.

- [ ] Contract chooses prepaid exclusively and excludes direct capture allocations.
- [ ] Separate immutable credit journal maps units and original debits with exactly-once compensation.
- [ ] Merchant credit authority is verified; no unrelated vendor balance is changed.

### FR-08 — Additional provider · P1

As a merchant, I connect another video provider. Dependencies: reusable adapter contract and second merchant need.

- [ ] Publish capability matrix for correlation, idempotency, cancellation, cost and URL lifetime.
- [ ] Pass the same recovery and delivery fixtures before activation.

### FR-09 — Buyer creative acceptance · P1

As a buyer, I can flag an unusable creative result. Dependencies: explicit revised commercial terms.

- [ ] Separate subjective feedback from technical billability; never silently revise an accepted contract.
- [ ] Proposed revised acceptance window and merchant support cost receive a new product/legal review before release.

### FR-10 — Merchant analytics · P1

As an operator, I assess product value. Dependencies: reconciled event definitions.

- [ ] Show support time, real avoided attempts, provider costs, captured and refunded amounts separately.
- [ ] Exclude synthetic fixtures and unresolved operations from realized savings.

### FR-11 — Hosted merchant onboarding · P1

As a platform operator, I onboard merchants lawfully and safely. Dependencies: PayPal platform eligibility and permissions review.

- [ ] Validate supported delegation/partner flow, merchant consent, region and account permissions before storing credentials or moving money.
- [ ] Tenant provisioning, offboarding and key isolation pass dedicated tests.

### FR-12 — Proactive delivery monitoring · P1

As a merchant, I detect broken access within retention. Dependencies: stable purchaser-route probing.

- [ ] Detect inaccessible assets without expanding purchaser privileges.
- [ ] Repair within policy or open reviewed remedy, with measured detection delay and alert suppression.

### FR-13 — Transaction reporting connector · P2

- [ ] Add PayPal reporting only for a demonstrated reconciliation gap, verifying availability and reporting delay.
- [ ] Do not use delayed reporting as the immediate source of capture truth.

### FR-14 — Workflow engine migration · P2

- [ ] Migrate to Temporal only when measured workflow complexity warrants it.
- [ ] Replay compatibility and in-flight migration preserve operation identities.

### FR-15 — Additional currencies · P2

- [ ] Explicit currency exponent, pricing, refund and provider cost conversion policies precede activation.
- [ ] Never aggregate unconverted amounts into one money total.

### FR-16 — Export integrations · P2

- [ ] Export a minimal evidence package with field-level redaction and expiring access.
- [ ] Export never implies a guaranteed dispute result or submits dispute evidence automatically.

## 6. Non-functional requirements

| Area | Requirement and verification |
| --- | --- |
| Correctness | Integer minor amounts, checked bounds, explicit currency. No money operation from arbitrary model text. Property and concurrency tests cover sums and reservations. |
| Performance | Target p95 internal API <500 ms excluding external calls at declared pilot load. Render and payment waits remain asynchronous. |
| Reliability | At-least-once transport with idempotent consumers and reconciled external effects. No end-to-end exactly-once claim. |
| Availability | Proposed 99.5% monthly portal SLO. Measure buyer retrieval and financial reconciliation separately. |
| Security | OIDC/session security, CSRF defense for cookies, RBAC, tenant isolation, secret segregation, signed callback verification, limited egress and media sandbox. |
| Privacy | Minimal consented operational data, explicit retention/deletion matrix. Proposed artifacts seven days, diagnostic evidence 30 days, financial record period set by merchant jurisdiction before launch. |
| Accessibility | WCAG 2.2 AA target for core journeys, automated scan plus keyboard/screen-reader checks. |
| Scale | Pilot planning 5,000 units/day across ten merchants after hosted onboarding. 100,000/day is a sizing scenario, not tested capacity. |
| Operability | Trace IDs across contract/unit/attempt/operation, redacted audit trail, reconciler alerts and restore rehearsal. |

## 7. Technical architecture

Five independently deployable TypeScript services own Commerce, Provider, Delivery, Investigation and Payments. Each owns its PostgreSQL data and credentials. Authenticated HTTP plus durable outbox/inbox and a Commerce saga coordinate the workflow. Payments owns all money reservations and journal records. Production media validation uses an isolated worker. Frontend implementation is excluded from the current task. The prototype uses a private persistent artifact volume; a shared object-store adapter remains a commercial scaling gate. [Current architecture](../backend/docs/ARCHITECTURE.md)

Runway is the proposed first adapter, subject to credential access and one real output test. A documented alternative provider can replace it before building, preserving the contract and marking provider-specific assumptions. Gemini is the available research model; production investigator model selection requires schema, safety, latency and held-out quality checks. MiroFish remains a discovery rehearsal and is outside the transaction runtime.

## 8. API specifications

All writes require authenticated role, tenant context and Idempotency-Key bound to method, path and body hash. Different body with same key returns 409. Server derives tenant/buyer from session rather than trusting body fields. IDs below are illustrative internal IDs. Error envelope includes code, safe message, trace_id and retryable flag.

### Create a batch

POST /v1/batches, merchant role. Unit definitions come from an allowed provider configuration.

```json
{"contract_version":"video-v1","unit_count":10,"unit_price_minor":500,"currency":"USD","provider_profile":"short-video-v1"}
```

201 response after durable creation, before external approval:

```json
{"batch_id":"bat_demo","version":1,"ceiling_minor":5000,"state":"AWAITING_BUYER_APPROVAL","approval_url":"/buyer/bat_demo/terms"}
```

Buyer POST /v1/buyer/batches/{id}/consent records the displayed digest and accepted terms. POST /v1/buyer/batches/{id}/paypal-order creates or resumes the linked PayPal order and returns its provider approval link. POST /v1/buyer/batches/{id}/authorize checks server-side order linkage after approval and enqueues authorization. Browser-return parameters never establish payment truth.

### Inspect an incident

POST /v1/batches/{id}/investigations, operator role. 202 response contains investigation_id and state. GET /v1/investigations/{id} returns facts, cited hypotheses and proposed_action, with no secrets. Read tools can be retried within budget; a provider submit cannot be hidden inside a read tool.

### Approve and execute a closure

POST /v1/batches/{id}/closure-preview derives a frozen proposal. Example response:

```json
{"proposal_id":"pro_demo","batch_version":19,"eligible_units":8,"amount_minor":4000,"currency":"USD","action":"FINAL_CAPTURE","approval_digest":"example-sha256","expires_at":"2026-11-08T12:05:00Z"}
```

POST /v1/proposals/{id}/approvals, reviewer role:

```json
{"approval_digest":"example-sha256","expected_batch_version":19}
```

202 response creates one reserved operation for the executor:

```json
{"operation_id":"op_demo","state":"RESERVED","amount_minor":4000,"status_url":"/v1/operations/op_demo"}
```

409 approval_stale requires new preview. GET /v1/operations/{id} shows RESERVED, DISPATCHING, PENDING, UNKNOWN, CONFIRMED or FAILED with safe evidence. POST /v1/batches/{id}/cancel records a cancellation request under the batch lock. An undispatched reservation can be canceled atomically; dispatched/unknown effects require read-back before void/refund review. GET /v1/buyer/batches/{id}/units/{unit_id}/content authorizes purchaser access and streams or issues a short-lived private URL. The verifier uses a narrowly scoped buyer-context credential.

POST /v1/captures/{id}/refund-proposals derives eligible unit amounts, reason and original capture linkage. It uses the same preview/approval/operation pattern. POST /v1/paypal/webhooks accepts raw callback body and headers, verifies authenticity before trusted processing, and durably deduplicates. Responses never expose model or provider internals to buyers.

## 9. UI and UX requirements

Buyer flow: clear contract and price ceiling → PayPal approval → batch progress → ready files and excluded units → exact confirmed settlement or honest pending state → support/remedy status. Example copy: “8 clips ready. Final charge $40. $10 of your authorization was not collected.” Do not promise immediate removal of a temporary funding-source hold.

Merchant flow: incident list → unit timeline → provider evidence and purchaser-route result → cited investigation → immutable closure preview → approval → operation receipt. Evidence grid compares logical units, attempts, file checks and billing allocation. AG Grid is useful here if actually integrated, with accessible alternatives for critical review. No decorative sponsor integrations.

Design must include empty, loading, degraded provider, rejected media, unknown submission, stale approval, canceled batch, expired authorization, pending refund and capture failure after delivery. Show a prominent operational pause control and explain what it stops. Demo data resets inside a private demo tenant, never by disabling authorization checks.

## 10. Data model

Every child row has tenant_id UUID and tenant-scoped foreign keys. Primary IDs are UUIDs. Monetary columns are BIGINT minor units with currency CHAR(3). Timestamps are TIMESTAMPTZ. Full schema and invariants are in architecture.

| Entity | Required fields and relationships |
| --- | --- |
| contract | id, tenant_id, buyer_id UUID, version INT, billing_model ENUM, terms JSONB, digest TEXT, currency, ceiling_minor, consent_at, deadline_at, retention_until |
| batch | id, contract_id, state ENUM, version BIGINT, authorization_id TEXT nullable, freeze_at nullable |
| unit | id, batch_id, logical_key TEXT unique per batch, unit_price_minor, eligibility_state, verification_id nullable |
| attempt | id, unit_id, provider TEXT, external_task_id nullable, submit_request_key TEXT, state ENUM, provider_cost_minor nullable |
| artifact | id, unit_id, storage_key TEXT, object_version TEXT, digest TEXT, media_metadata JSONB, expires_at |
| observation | id, unit_id nullable, source_kind ENUM, source_reference TEXT, digest TEXT, observed_at, redacted_payload JSONB |
| verification | id, unit_id, contract_digest, artifact_digest, buyer_id, checker_version TEXT, observed_at, checks JSONB, outcome ENUM |
| proposal and approval | proposal id, batch_version, action, unit_set JSONB, amount_minor, digest, expiry; approval actor UUID, timestamp, digest |
| payment_operation | id, batch_id, action ENUM, request_key TEXT unique per merchant/environment, body_hash TEXT, reserved_minor, external_id nullable, state ENUM |
| allocation | unit_id, capture_operation_id, captured_minor, confirmed_refund_minor, pending_refund_minor, version |
| journal | id, operation_id, event_kind, amount_minor, currency, provider_reference, recorded_at; immutable corrections |
| inbox and outbox | event_id TEXT unique per source/tenant, payload_digest, processing_state, attempts, next_attempt_at |

Retention follows data purpose. Deleting the video after agreed retention does not delete legally required payment records. Final duration requires merchant jurisdiction review. A buyer can request deletion and receive a clear explanation of remaining required records.

## 11. Third-party integrations

| Integration | Necessary job | Eligibility or limit |
| --- | --- | --- |
| PayPal Orders v2 | Order approval and authorization for the batch ceiling | Merchant account, region and API permissions must pass real sandbox gate |
| PayPal Payments v2 | Authorization lookup, final partial capture, void, capture lookup, original-capture refund and refund lookup | Endpoint-specific idempotency and final_capture behavior verified before claims |
| PayPal Webhooks | Timely provider events with signature verification and read-back | Duplicates, delay and out-of-order handling mandatory |
| One video provider | Submit/correlate jobs, retrieve results and costs where supported | Known URL expiry, cancellation semantics and unknown-submission policy |
| AI model | Cited hypotheses and permitted next investigation reads | No credentials or money authority; capped and replaceable |
| Render | Web, worker and managed PostgreSQL deployment | Verify paid plan backup/worker features and budget at build time |
| AG Grid | Dense unit/attempt/evidence comparison | Use actual component and document accessible review path |
| APIMatic | Optional generated API contract tooling | Add only if used and proven useful; otherwise no sponsor claim |

Authorization is not escrow. General PayPal authorization validity is 29 days, with a three-day honor period; follow actual resource/endpoint conditions and keep P0 batches short. Shipping, subscriptions, payouts and dispute writes do not serve this P0 lifecycle. [PayPal delay capture](https://developer.paypal.com/checkout/delay-capture)

## 12. Error handling

| Failure | Required behavior |
| --- | --- |
| Lost provider callback | Poll original task and recover existing bytes, no immediate new inference |
| Unknown job submission | Preserve uncertainty and cost risk, stop repeat generation until correlation/manual resolution |
| Expired provider URL | Try owned archive, then provider-supported recovery; abstain if unavailable |
| Wrong or broken file | Quarantine, reject eligibility, show evidence and supported recovery choices |
| Model unavailable or misleading | Pause normal completion, reject unsupported citations, preserve reads/reconciliation/safe release |
| Capture pending or timeout | Keep original operation reserved and UNKNOWN/PENDING, reconcile; no paid label or substitute key |
| Capture fails after access | Report unpaid delivery risk to merchant, never fabricate paid status or silently reprice |
| Authorization expires | Block capture and new inference; explicit new buyer consent required for any new agreement |
| Duplicate/cross-tenant callback | Deduplicate or reject, audit redacted event; no state mutation across tenant |
| Refund timeout | Reserve refund amount, reconcile original operation and block competing remedy |
| Storage/restore incident | Pause new billability, notify operators, restore and verify buyer access |

## 13. Testing requirements

Release suite covers integer money bounds, state transitions, tenant isolation, provider schema contracts, output validation, purchaser access, model citation checks, webhook authentication, duplicate callbacks, capture/refund races, unknown writes and worker restarts. Real sandbox evidence includes approved authorization, positive final partial capture, zero-output void, confirmed refund and subsequent resource read-back. Actual provider bytes must pass buyer-route playback. A deterministic fixture is labeled as such in the demo.

Held-out AI evaluation compares identical incident evidence with a competent deterministic baseline and with the investigator, measuring correctness and operator time. MiroFish role-play is separate and cannot pass this gate. Accessibility and browser tests cover buyer and operator journeys. Load and restore results must state environment, dataset, duration and limitations. [Evaluation plan](EVALUATION_AND_LAUNCH.md)

## 14. Milestones and launch

Gate A: prove merchant authority, provider correlation, real bytes and sandbox semantics. Gate B: implement contract-to-delivery-to-settlement with invariants. Gate C: prove failure recovery and AI contribution. Gate D: accessible resettable private demo and under-three-minute presentation. Target freeze is 11 November IST ahead of official deadline 13 November 01:30 IST. These are planning dates with dependencies, not delivery promises.

After the event, run diagnosis-only shadow pilots, then reviewed redelivery, then bounded settlement. Commercial launch requires permission/region review, retention policy, tested restore, support ownership and unit economics. If the PayPal/provider gate fails, stop claiming a complete payment lifecycle and explicitly revise the scope. If a normal queue fully solves the merchant's incidents, do not force an AI product into that installation.

## 15. Implementation notes for AI

Read root AGENTS.md, this PRD and the architecture before implementation. Existing starter implements earlier PromiseBack concepts and is not proof of this product. Do not silently overwrite unrelated work, introduce a second payment model, infer provider success from model prose, or call PayPal directly from the browser/model. Start with contracts and money invariants, one adapter and a small vertical slice. Use strict schemas and typed state transitions. Place network calls outside database transactions and reconcile after timeout. Preserve operation identities across retries. Every P0 ticket produces a reproducible receipt or test artifact. Mark mock, actual provider, sandbox and live evidence distinctly. Expand scope only after gates pass.

Implemented backend layout is backend/src/services for the five domain APIs, core for scoped persistence/auth/transport, adapters for actual integrations and media, domain for schemas and pricing, migrations for SQL, scripts for setup/checks and test for API/failure verification. Each service runs separately and cannot access another service's database. Keep fixtures/evaluations separate from customer records. Current APIs and storage behavior are documented in backend/docs/API.md; earlier route examples in this PRD describe intended interactions rather than the exact generated implementation contract.

Use strict TypeScript, a schema validator such as Zod, an official PayPal API contract or generated typed client, a maintained PostgreSQL queue, and pinned FFmpeg tooling. Verify current official dependency documentation and account API support at implementation. Avoid arbitrary model-generated SQL, shell tools, broad MCP financial permissions and a new distributed-service framework without a measured need. Build order and test evidence follow the backlog gates.
