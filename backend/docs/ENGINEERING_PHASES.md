# Engineering execution record

Authorized scope: backend, database, API, infrastructure, security, testing and documentation. Frontend phases and UI performance/accessibility are excluded at the user's request. This record must distinguish implemented code from verified integrations and production targets.

## Phases 1–3: product, plan and architecture

The product restores missing paid AI-video work and settles an explicit direct-batch contract. Five services own Commerce, Provider, Delivery, Investigation and Payments domains. APIs use versioned REST for inspectable operations and OpenAPI documentation. The Commerce saga coordinates local transactions through authenticated messages, outboxes and idempotent receivers. Service database access is private. Normal closure requires a current real-model assessment, validated output/access evidence and confirmed PayPal state. Model unavailability pauses new assessments; reconciliation and safe cancellation remain operational.

Risks: customer adoption and AI benefit unvalidated; capture failure after delivery exposes merchant risk; provider tasks may be uncorrelatable after unknown submission; microservices introduce eventual consistency and more deployment work. Never automatically regenerate an unknown attempt. Preserve one merchant/one provider/USD scope. Credentials and actual provider/sandbox receipts are independent gates.

## Phases 4–5: data and API design

Each service owns PostgreSQL with tenant-scoped entity/version records, audit trail, command inbox and outbox. Payments additionally owns operation reservations, financial unit allocations and a refund bound. Commerce owns consent, contracts, permits and saga versions. Provider owns attempts, Delivery owns immutable artifact metadata and assessments, Investigation owns snapshots and model runs. Domain schemas validate persisted JSON and commands; database uniqueness and conditional writes protect concurrency. No cross-service joins or distributed ACID claim. Migration versioning precedes requests. Local embedded PostgreSQL is a development option; managed PostgreSQL is the deployment adapter.

APIs use short-lived Ed25519 JWTs with issuer/audience/tenant/environment/role validation. External buyer identity is bound to subject. Internal endpoints accept only their allowed service identities. Require idempotency for external effect creation, integer money, bounded payloads and pagination. Return consistent safe errors with trace IDs. OpenAPI and executable API collection are deliverables.

## Phase 6: excluded

No frontend implementation. Backend customer content endpoints still enforce buyer access.

## Phases 7–8: structure and implementation

Use src/core for database/auth/transport/validation, src/services for domain APIs, src/adapters for PayPal/Gemini/Runway, src/domain for contracts and financial invariants, migrations for versioned SQL, scripts for local provisioning and integration checks, test for meaningful behavior tests, infra for deployment, docs for operations. Domain modules never import another service's database implementation. Record actual implementation coverage at final review.

## Phases 9–16: review gates

Review code, security, failure behavior and performance after the vertical slice. Run type checking, domain/API/integration/failure tests, dependency audit and a bounded benchmark. Inspect wrong-tenant and wrong-audience access, stale approvals, duplicate commands, unknown captures/refunds, missing AI and PayPal, malicious URLs/media and worker restarts. Add deployment, backup, restore, rollback and troubleshooting instructions. Final review records passes, failures, unsupported paths and unexecuted real-integration checks. Production readiness is not established by an infrastructure file or a passing fixture suite.

## Current integration access

Actual Gemini recovery over fixture media/payment evidence passed. User-supplied free-tier Groq/NVIDIA keys now also passed real schema/citation checks. The original India Sandbox merchant rejected USD; an explicitly approved US test app resolved the configuration. Actual adapter-level buyer approval, authorization, $40/$50 final partial capture, $5 original-capture refund and separate void passed. Original configuration is retained privately. Runway remains unconfigured and paid inference disabled. A combined actual-provider product lifecycle, actual signed callbacks and cloud deployment remain unverified. See INTEGRATIONS.md.

## Final review record

Phases 1–5 and 7–16 were applied to the backend prototype. Architecture/data/API/operations documents and implementation are present. Strict typing/build passed. Final suite: 22 tests passed, zero failures. Five separately launched service processes passed HTTP checks; Postman/Newman passed four assertions across two requests. Actual Gemini selected a bounded provider read and supported original fixture recovery; neither a real provider render nor a PayPal Sandbox transaction is claimed. Backend dependency audit reported zero vulnerabilities, public-source secret-pattern scan found no matches, and Compose config validation passed. Security/failure review led to corrections for refund-key handling, replay/race behavior, isolated decoding, immutable journal, daily AI admission and dispatch pause.

The local microbenchmark measured p50 about 5.48 ms and p95 about 7.52 ms for 50 authenticated empty-list injection requests, not deployed throughput. Distributed load, container execution, production PostgreSQL concurrency, external OIDC, shared object storage, restore rehearsal, actual provider/Sandbox receipts and held-out AI advantage remain explicit launch/acceptance gates. Frontend is excluded. See VERIFICATION.md and SECURITY_REVIEW.md for limits rather than treating every phase as a production-readiness certification.


## Subsequent local hardening review, 8 November

Latest reproducible gate: 34 tests passed, zero failed; strict typing, build and OpenAPI export passed. Native PostgreSQL 18.6 passed nine checks: concurrent idempotent commands/row updates, runtime RLS, immutable records, refund reservation bounds, rollback, stale lease fencing, encrypted database restore and restart durability. The logical restore includes fixture financial journal, money and queue records; it does not cover media/cross-service recovery. Added webhook lookup/deduplication fixes, operator diagnostics, indexed operational lookup, issuer-bound overlap key rotation, graceful worker drain and Gemini/Groq/NVIDIA fallback with explicit free-tier admission. Dependency audit reported zero vulnerabilities. evidence/local-quality.json is the rerunnable result. Actual provider output, combined product lifecycle/signed callbacks, external identity, media/cross-service disaster recovery, alert delivery and cloud launch remain separate gates.


Final external gates completed: evidence/paypal-lifecycle.json records real Sandbox adapter receipts; evidence/ai-providers.json records all three real hosted-model checks. A newly created Sandbox app was explicitly approved by the user; original credentials are retained. Nothing here establishes real commercial output generation or production availability.


Combined five-domain integration review: the initial real-model run paused before capture because its action was a conservative LOOKUP rather than RESTORE_ACCESS. Action semantics were clarified without relaxing citation or financial gates. Adding explicit reassessment exposed unstable observation IDs on a retried command; those now derive from immutable snapshot facts. Regression coverage verifies preserved history, budget admission and identical-key replay/conflict. The original Sandbox authorization and private databases were retained throughout. This is development feedback, not a frozen held-out AI-benefit result. Final combined-run evidence, if passed, is evidence/service-sandbox-workflow.json and explicitly labels fixture video and in-process API transport.


Combined integration gate passed (backend/evidence/service-sandbox-workflow.json): actual Gemini, actual Sandbox buyer approval/authorization and one confirmed $40 capture from the same $50 authorization through the five domain APIs. The original locally generated fixture file was recovered, eight purchaser routes were verified, and one capture journal entry persisted. This test uses authenticated in-process Fastify calls, five persistent PGlite databases, eight fixture MP4s and two fixture failed tasks. It does not establish actual video-provider output, separate-process HTTP e2e, signed callback delivery or commercial production readiness. The initial conservative AI action and reassessment retry failure were fixed without relaxing evidence/money gates or creating a replacement authorization. Explicit refresh_reason preserves the prior investigation; stable observation IDs preserve retry payload identity. The final local suite now passes 34 tests, plus nine native PostgreSQL checks. Frontend and cloud deployment remain excluded/unexecuted.

Payment concurrency follow-up: reconciliation leaves undispatched reservations alone and preserves a confirmation recorded by another worker. Delayed pending responses and dispatch errors cannot roll back confirmed settlement. Concurrent maintenance workers recheck the reconciliation cooldown while holding the operation row lock. A fixture test delays a pending PayPal response, confirms through a second read, then releases the stale response and verifies one capture call and one journal entry.

## Frontend completion and web boundary — 10 November

Added the cookie-session web gateway under src/web. It serves built SPA assets and allowlisted same-origin Commerce/private-media routes, validates OIDC code/PKCE/nonce/issuer/audience, maps verified subjects to provisioned membership and derives internal authority server-side. Browser bearer headers cannot elevate role. Secure HttpOnly cookies, CSRF/origin checks and session revocation protect writes. Development helper remains loopback-only and is absent from production assets. Production requires a separate PostgreSQL web store, migration credentials, external OIDC configuration and service access; external identity login has not been executed.

Added safe environment/readiness, aggregate operation health, batch financial/activity projections, original-task lookup and retained support cases. Normal refunds require an exact expiring review tied to capture, allocation, amount and assessment, validated while reserving funds atomically; same-key replay returns the original reservation. Review metadata contains no credentials or provider signed URLs. Existing financial invariants remain authoritative.

Validation: strict typecheck passed. Latest full backend suite had 38/39 pass: media-worker process startup exceeded its 15-second test deadline during concurrent build/test load. The failed test rerun alone passed in 1.75 seconds. Earlier full 39-test pass remains historical, not the latest uninterrupted result. Frontend 11 domain tests and four hosting-worker tests passed; production build passed before the final visual review changes and is rerun after them. Hosted Gemini returned cited findings over synthetic provider observations; browser recovery increased published clips seven to eight. This is not actual provider output or a new actual PayPal checkout receipt.

Focused refund-eligibility follow-up passed 2/2 experience tests after strict typecheck: a three-unit batch with only two captured units exposes only those two; a reserved/refunded unit is excluded from further selection. One initial test command was launched from the workspace root and failed locating migrations; rerun from backend/ passed. Production frontend build passed after final changes. Built client scan found no localhost helper paths or development display controls.
