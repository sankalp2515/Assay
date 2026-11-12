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
| S-13 | High. A merchant-reported task points the downloader at an internal address (SSRF) or a host the merchant doesn't own. | The reported URL's exact host must be in `REPORTED_OUTPUT_HOSTS`, configured in advance; empty means reported tasks are refused. URLs with credentials or a non-443 port are refused. The downloader re-checks the host, resolves DNS and refuses private addresses, refuses redirects and caps the size. Looked-up sources (Runway, Replicate) can't take a caller URL. Tests cover a link-local metadata URL and URL smuggling. |
| S-14 | Medium. A merchant reports a task as finished to bill for it. | A report only creates an attempt marked `merchant_reported`. Billing still needs Assay's own download, isolated decode, digest and a verified buyer route. |
| S-15 | Medium. Forged or replayed merchant webhooks. | HMAC-SHA256 over the timestamp and raw body with a 32+ character secret. The reference verifier uses a constant-time compare and a 5-minute window, and consumers dedupe on the event `id`. The URL must be https (http only for localhost), with no credentials or redirects. The secret is never logged. |

Containers run as the non-root `node` user with a read-only root filesystem, all capabilities dropped and `no-new-privileges`. The media verifier is on an internal-only network. The judge demo container runs with `network_mode: none`. `npm audit` reports 0 known vulnerabilities at review time.

## 12 November review of the merchant platform additions

| ID | Risk | Control |
|---|---|---|
| S-16 | High. A leaked API key, or one merchant's key used against another tenant. | Keys are `assay_sk_<tenant>_<32 random bytes>`. Only a SHA-256 is stored and the value is shown once. The tenant in the key selects the row-level-security scope, so a key can only read its own tenant. Keys are accepted only at Commerce on `/v1/` routes, never on internal service routes. Revocation takes effect on the next request. Tests cover cross-tenant reads, revocation, a tampered key and an internal route. |
| S-17 | High. An automation key approves a capture. | Scope `integration` maps to its own role, which is listed only on intake and read routes. Approve, refund, cancel, controls and key management require `operator`. Test asserts approve returns 403 for an integration key. |
| S-18 | Medium. A buyer token opens another batch, or another buyer's clips. | Buyer sessions bind one buyer and one batch for 30 minutes. They are minted only by the merchant for a batch whose `buyer_id` matches, and are refused on any other path. |
| S-19 | Medium. Open sign-up used to create tenants in bulk. | Closed by default. `invite` mode needs a 12+ character code compared in constant time. The route is limited to 5 per hour per address. Each account is a new tenant and is registered with every worker before it can accept work. |
| S-20 | High. A refund during an open PayPal dispute pays the buyer twice. | The dispute record is read back from PayPal, never taken from the webhook body. It is linked to a batch only through a capture this service confirmed. While it is open, refunds are refused with `dispute_open`, inside the same lock that reserves refunds. |
| S-21 | High. A merchant claims another seller's PayPal account during onboarding. | The redirect is a hint only. The merchant id must read back from PayPal with `tracking_id` equal to this tenant, `payments_receivable`, a confirmed email and a third-party grant to this app's client id. A platform-scope registry refuses an account already linked to another tenant. Partner mode is off by default. |
| S-22 | Medium. Mixed currencies summed, or decimals sent for JPY. | One batch has one currency. Exact PayPal value strings come from per-currency exponents, and every read-back compares currency and value. The journal constraint lists the allowed currencies. Impact totals are reported per currency. |
| S-23 | Medium. Demo sign-in enabled on a real deployment. | Off unless `WEB_DEMO_LOGIN=true`. Sessions carry `demo: true`, and the deployment guide restricts it to the Sandbox demo tenant. |
| S-24 | Medium. Cloud credentials stored in configuration. | GCS and Vertex AI use the VM or Cloud Run service account through the metadata server; no key file exists. The bucket blocks public access and writes are create-only (`ifGenerationMatch=0`). Vertex spend needs `VERTEX_CREDITS_CONFIRMED=true`. |
| S-25 | Medium. The demo provider bills for clips nobody generated. | Off unless `DEMO_SIMULATOR=true`, operator-only, once per authorized batch, and labeled `simulated: true`. Its clips still go through the reported-host allow-list, the download checks, the isolated decode and the buyer-route check. Only for the hosted Sandbox demo tenant. |
| S-26 | Medium. Sign-up through the gateway abused, or every visitor sharing one rate-limit bucket. | Same-origin only, and 5 per hour per visitor at the gateway, which reads the client address from Caddy's `X-Forwarded-For` only when `WEB_TRUST_PROXY=true`. Commerce's own limit is configurable. `invite` mode is still recommended. |
| S-27 | High (found by an external Codex review). Hosted demo visitors shared one demo tenant, and a demo operator could reach payment controls and API keys, so one visitor could affect another's run. | Each demo sign-in gets its own workspace: a fresh tenant with its own merchant and buyer, registered with every worker for 24 hours (`DEMO_WORKSPACES`), and kept across role switches by an HttpOnly pointer cookie. Demo sessions get 403 on `controls`, `api-keys`, `merchant` and `buyer-sessions`. A test runs two simultaneous visitors: neither can read the other's batch, and both are refused on controls and keys. |
| S-28 | Medium. A PayPal webhook for a tenant other than `MERCHANT_TENANT_ID` (a self-serve merchant or a demo workspace) was recorded against the wrong tenant. | Payments indexes every PayPal id it receives from PayPal (order, authorization, capture, refund) to its tenant, in the platform scope. Webhooks map through that index; a webhook body is never trusted for the mapping. Read-back still decides state. |
