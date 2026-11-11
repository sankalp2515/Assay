# Security and failure review

8 November 2026 · Source review and local tests, not an independent penetration test

## Corrected during implementation

| ID | Severity / attack or failure | Correction and evidence |
| --- | --- | --- |
| S-01 | High: concurrent or replayed capture could duplicate collection | Approval claim, unique final reservation/unit allocation, operation state lock, stable external key and unknown-state read-back. src/services/payments.ts settlement/execute paths; concurrency and lost-response tests. |
| S-02 | High: concurrent refunds could overcompensate a unit or exceed capture | Atomic pending reservations, per-unit remedy uniqueness and SQL balance constraint. migrations/002_payments.sql and refund tests. Initial request-key/UUID lookup bug was found and fixed before review completion. |
| S-03 | High: shared-state/caller confusion could expose another tenant's files or authorize another merchant's money | Signed issuer/audience/environment/role checks, tenant RLS with nonowner transaction role, buyer subject binding and merchant/currency/source checks. src/core/auth.ts, src/core/database.ts and wrong-tenant/buyer/audience tests. |
| S-04 | High: attacker-controlled output URL or malformed media could reach internal services or execute in a credentialed process | Exact provider origin, public DNS/address validation and pinning, no redirects, byte/time caps, dedicated production verifier with no business credentials and internal-only Compose network. src/adapters/media.ts, src/verifier.ts and SSRF/media worker tests. Local development is not equivalent OS sandboxing. |
| S-05 | Medium: model invents evidence or treats source instructions as authority | Structured schema, literal citation validation, known-unit read scope, bounded tools/output and no money tools. Daily tenant admission cap. Unsupported-citation/unit tests and actual Gemini evidence. Semantic usefulness still requires held-out evaluation. |
| S-06 | High: financial history rewritten by normal runtime role | Dedicated financial_journal grants SELECT/INSERT only, tenant scope, unique operation/event and resource digest. Audit is append-only for runtime. Confirmed accounting/outcome commit atomically. |
| S-07 | Medium: dependency outages create false success or prevent safe fund release | Normal AI/PayPal gates fail closed. Safe cancellation/void, buyer access and payment read-back remain possible without new AI. Dedicated outage/cancel tests. |

## Open launch risks and required checks

| ID | Priority | Remaining gate |
| --- | --- | --- |
| R-01 | High, blocks real settlement claims | Actual Sandbox account capability, webhook delivery, partial capture, void/refund and resource association unverified without credentials/buyer approval. Fixture tests cannot validate PayPal behavior. |
| R-02 | High, blocks commercial deployment | Real provider output/CDN behavior and production container/managed-PostgreSQL roles have not been exercised. Docker configuration validation is not a container isolation proof. |
| R-03 | High, blocks public multi-merchant launch | Local CLI-issued identities do not implement production OIDC onboarding, account recovery, merchant delegation (overlapping service-key rotation is now implemented and locally tested). P0 is a restricted single-merchant prototype. |
| R-04 | Medium | Rate limiting is process/IP-local; distributed abuse control, external alert routing, service-budget monitoring and network egress enforcement on the chosen cloud must be configured. |
| R-05 | Medium | Single private artifact volume, no shipped object-store adapter. Encrypted service database restore has passed locally; full media/cross-service restore, diagnostic retention/deletion and jurisdiction-specific financial retention remain required. |
| R-06 | Medium | Schema-valid cited AI can still draw a wrong conclusion. Deterministic checks and approval contain money authority; no measured AI advantage or production accuracy claim is established. |
| R-07 | Medium | Unknown refunds without known IDs, uncorrelatable authorizations and expired claimed permits require operator investigation. Never release reservations or generate a new write based only on timeout. |

Dependency audit of the backend lockfile reported zero known vulnerabilities at review time. That is not a security guarantee. The separate Newman tool reported deprecated dependencies during its ephemeral installation; it is not part of the backend runtime lockfile. Private Newman reports and environment/token files remain under .local and are excluded from public artifacts.

No frontend audit was performed because frontend is excluded. No live financial transaction, cloud key creation or public account change was performed. Credentials must never enter public logs or reports. The deployed service must use restricted runtime database credentials, not migration/owner credentials. Re-run review after provider/account activation and before public access.

## Source anchors at final review

- Identity: src/core/auth.ts:40. Tenant transaction role: src/core/database.ts:34.
- Settlement reservation: src/services/payments.ts:341. Dispatch state/pause: src/services/payments.ts:493. Refund bounds: src/services/payments.ts:631.
- Immutable journal privileges: migrations/002_payments.sql:21. Confirmed journal insertion: src/services/payments.ts:940.
- Output origin/DNS checks: src/adapters/media.ts:28. Isolated verification requirement: src/adapters/media.ts:186.
- Citation validation: src/domain/contracts.ts:145. Daily AI budget: src/services/investigation.ts:64.

These anchors identify reviewed controls, not a claim that every line is independently verified or vulnerability-free.


8 November final hardening: capture and void confirmation bind exact resource identity. Refund confirmation requires amount/currency/status plus an up-link to the original capture at an allowlisted Sandbox API host. Actual Sandbox adapter receipts passed these checks. Webhook matching is indexed over all operations and receipt/enqueue is atomic. Fallback model keys are now admitted under user-confirmed free-tier flags and all hosted checks passed; no confidential merchant data was used. Public return/cancel endpoints are deliberately informational and do not authorize, capture or void anything from URL parameters.

## 11 November review of the recovery-first additions

| ID | Severity and attack | Fix and evidence |
| --- | --- | --- |
| S-08 | Medium. A buyer spams support messages to drain the merchant's shared daily AI budget, stalling real investigations. | Per-order AI reading cap (`MAX_BUYER_READINGS_PER_BATCH`, default 5); later messages go to the merchant queue. The hard cap is 50 messages per order, checked only for new commands so idempotent replays still work. Test: "a buyer cannot drain the merchant's AI budget". |
| S-09 | Medium. Request logging could capture PayPal return tokens in query strings, or bearer and cookie headers. | Services previously ran with logging off. They now emit structured JSON logs with path only (no query), no headers and no bodies. 5xx errors log the error type and code, not the message. Test: "request logs carry no query strings, headers or tokens". |
| S-10 | Medium. A signed delivery statement could be replayed as a service token, since both use the Payments Ed25519 key. | The statement has a distinct `typ` and no audience, tenant or time claims, so `authenticate` rejects it. Test asserts this. Key separation is a later hardening option. |
| S-11 | Low. Buyer text could be injected into the PayPal transaction note. | `note_to_payer` is built only from server-computed amounts and a digest; no buyer or model text reaches PayPal. |
| S-12 | Low. The model claims quotes or clips not in the message, or tells the buyer a refund is approved. | Literal-quote and clip-range validation. Replies come from rules only, and the model has no write or money tools. Tests cover forged quotes and out-of-range clips. |

Containers run as the non-root `node` user with a read-only root filesystem, all capabilities dropped and `no-new-privileges`. The media verifier is on an internal-only network. The judge demo container runs with `network_mode: none`. `npm audit` reports 0 known vulnerabilities at review time.
