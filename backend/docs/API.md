# Backend API contract

Exported [Commerce](openapi/commerce.json), [Provider](openapi/provider.json), [Delivery](openapi/delivery.json), [Investigation](openapi/investigation.json) and [Payments](openapi/payments.json) OpenAPI documents describe registered routes and request schemas. JSON response bodies expose typed domain state but the current exported response schemas are permissive objects; client code should validate the described state-specific fields. Contract generation is repeatable with npm run export:api. Breaking changes require a new /v2 route or compatible schema revision.

## Identity

Local public clients present a short-lived Ed25519 token from the configured operator issuer, audience commerce, sandbox environment, tenant, subject and operator/buyer role. Buyer access is bound to subject. Internal calls use independently provisioned service identities and exact target audience. The receiving route allowlists callers. Body tenant/merchant fields cannot establish authority. Delivery content tokens are issued for the known buyer and audience delivery. No cookie authentication or cross-origin credentials are enabled. External OIDC login is a production onboarding gate.

## Requests and responses

Use Content-Type application/json and an Idempotency-Key on POST. Invalid body is 400, missing/invalid token 401, unauthorized role 403, unavailable scoped record 404, state/idempotency conflict 409, upstream rejection/invalid artifact 422 and unavailable integration 503. Error envelope contains code, message, trace_id and retryable. A safe unknown outcome is not a failed payment. Never retry a financial effect under a different logical key after timeout.

Create batch example:

```json
{"buyer_id":"00000000-0000-4000-a000-000000000001","unit_count":10,"unit_price_minor":500,"currency":"USD","prompt":"A blue bird flying through a quiet forest"}
```

The response includes id, units with logical IDs/prices, ceiling_minor 5000, contract_hash, state, version, deadline and retention_until. The contract defines technically valid purchaser-retrievable output. It does not guarantee creative quality. Buyer access precedes capture, and merchant bears unpaid-delivery risk.

## Asynchronous investigation and settlement

POST investigate submits a durable intent and returns assessment id/state. Poll investigation. Repeating investigate adopts a valid result only if the evidence snapshot is unchanged. RESERVED/RUNNING is not a valid closure assessment. WAITING_FOR_AI or INCONCLUSIVE requires a new reviewed attempt or more evidence. The model can request only bounded reads for known units; its citation IDs and literal quotes are validated. The normal money amount comes from contract rules.

Closure preview expires after 45 seconds, with purchaser verification receipts valid for at most 60 seconds. Approval binds the exact evidence, unit set and amount. If expired or stale, re-investigate/adopt and create a new preview. Once Payments claims a permit, cancellation requires proof of dispatch state rather than an assumed rollback. Payments reserves unit allocation and refund bounds in its own database. Capture/refund reconciliation can continue while AI is offline.

## Pagination and limits

GET /v1/batches supports limit 1–100 and an after UUID cursor, ordered by immutable ID. Default is 25. Request bodies are at most 64 KiB. The application rejects unsupported currencies, unknown fields, noninteger prices, more than ten units and oversize prompts. Default process-local limit is 120 requests per minute per source IP. This is a prototype guard, not a distributed abuse-control system. A trusted gateway/rate-limit policy must precede multireplica commercial use.

## Data ownership and ER outline

Commerce: contract/batch 1→N logical units, batch 1→N proposals, proposal 1→1 claimable permit; immutable evidence snapshot references external service IDs. Provider: logical unit 1→1 attempt in P0, attempt→provider task. Delivery: unit 1→1 artifact in P0, artifact 1→N verification receipts. Investigation: batch 1→N assessments, assessment→bounded evidence/tool history. Payments: batch 1→1 final settlement, settlement 1→N unit allocations, original capture 1→N approved refunds, unit→at most one remedy reservation. Tenant-local relationships are checked through authenticated APIs and domain validation; no cross-database FK exists.

All services use local entity records with explicit tenant/kind/id keys and conditional versioned updates. JSONB provides aggregate snapshots in this prototype; financial bounds and unique unit allocations use dedicated SQL tables and database constraints. Normalized reporting and shared object storage are future adapters, not implemented tables claimed by the old target design. Audit is append-only for runtime roles. Migrations are versioned, additive and run with separately controlled migration authority in deployment.


## Explicit investigation refresh

`POST /v1/batches/{batch}/investigate` accepts `{}` for the normal cached/current investigation or `{"refresh_reason":"At least ten characters explaining the operator review"}` for an explicit fresh assessment. Operator identity, Idempotency-Key, the daily AI budget and normal batch locks still apply. A valid inconclusive assessment is not automatically retried through other models. Refresh preserves the previous assessment record and cannot edit contract prices or authorize money. Unchanged snapshot facts produce stable observation IDs; repeating the same refresh key/payload returns the same assessment. Reusing that key with a different reason conflicts. New observations invalidate old approval evidence through the existing snapshot/version checks.

The public GET /v1/paypal/return and /v1/paypal/cancel endpoints are browser destinations. They do not require an API token or mutate payment state. Order creation adds `?batch=<id>` to both PayPal URLs. When `BUYER_RETURN_BASE` is set (https, or http on loopback), a valid batch UUID gets a 303 to `<base>/#/buyer/<batch>/agreement`, where the buyer's authenticated check confirms the authorization; PayPal's `token` and `PayerID` are not forwarded. Without it, or with an invalid batch value, they return an informational body with `payment_confirmed: false`. The actual buyer session must call the authenticated authorization/status endpoints; a redirect is never proof of cash. OpenAPI marks these and the PayPal-signature-authenticated webhook as exceptions to bearer-token authentication.

## Experience and web entry points — 10 November

Commerce adds GET /v1/readiness, /v1/operations/overview, /v1/batches/:batch/financials, /settlement-status, /activity and support-case routes. Operator task lookup reads the original attempt and requires batch ownership; no replacement inference is implied. POST /v1/batches/:batch/refund-preview creates an exact expiring approval; normal POST /refunds supplies proposal_id and approval_digest. Read current source/OpenAPI for DTO fields. Buyer projections remain ownership-scoped.

Web gateway: GET /api/login and /api/callback; GET /api/session supplies safe member/session/CSRF metadata; POST /api/logout revokes session; allowlisted /api commerce/media routes forward with server-generated authority. Run npm run web:migrate with WEB_MIGRATION_DATABASE_URL before non-local npm run web. Required configuration is listed in backend/scripts/web.ts; put private values only in backend/.env. External OIDC has not been configured/tested.

Financial projection includes refundable_units (unit_id, amount_minor), selected from confirmed capture allocations without an existing unit remedy. This is a read-time aid; atomic reservation and exact review validation remain authoritative during submission.

## Buyer messages, delivery statements and impact (10 November)

**Buyer messages.** `POST /v1/batches/{batch}/support` (buyer or operator) still saves the message first. The case now carries a `reading`:

- The Investigation service asks the model to turn the buyer's free text into claims. Each claim has clip numbers, an issue type (`NOT_RECEIVED`, `WONT_PLAY`, `WRONG_CONTENT`, `BILLING_QUESTION`, `OTHER`), a literal quote from the message, and a flag for attempts to instruct the system.
- Validation rejects quotes that aren't in the message and clip numbers outside the order.
- Deterministic rules then decide each clip's outcome from Delivery and Payments records:
  - `ALREADY_AVAILABLE`
  - `RECOVERY_QUEUED` (an original exists but was never published)
  - `NOT_CHARGED`
  - `MERCHANT_REVIEW`
  - `STATEMENT`
- The buyer reply is written by those rules, not by the model.
- The model never issues refunds, publishes files or changes amounts.
- If AI is unavailable, the case is kept with `reading.state = WAITING_FOR_AI`. A replay with the same Idempotency-Key returns the stored reading.
- Reading shares the per-tenant daily AI budget.

**Delivery statement.**

- When Payments reserves the final settlement, it records a per-clip statement built from the exact permit and the purchaser-retrieval receipts. The statement lists each clip, whether it was charged, its SHA-256, its receipt ID, and the amounts authorized, charged and not taken.
- The PayPal capture carries `invoice_id` = the permit ID and a `note_to_payer` summarising the outcome. Example: "Charged $40.00 for 8 of 10 clips delivered. $10.00 of your $50.00 authorization was not taken. Statement …".
- `GET /v1/batches/{batch}/statement` returns an Ed25519-signed compact JWS (`typ: delivery-statement+jws`) only after PayPal read-back confirms the capture or void. Before that it returns the unsigned draft with `signed: false`. Pending is not paid.
- `POST /v1/statements/verify` checks a JWS.
- `GET /v1/statements/keys` is unauthenticated and returns only the public verification key(s).
- The statement payload has no audience, tenant or time claims, so it can never be used as a bearer token. A test proves this.

**Impact.** `GET /v1/operations/impact` (operator) summarises the tenant's own records:

- clips recovered without a re-render, and their list value
- estimated re-render cost avoided, using the merchant-configured `PROVIDER_RERENDER_COST_MINOR` (an estimate, not a measured price)
- amounts authorized, charged and never taken across settled batches
- buyer-message outcome counts

## Merchant task intake, recovered clips and approval window (11 November)

- `POST /v1/batches/{id}/tasks` registers a provider task against a unit. `/attempts` is the older name and stays. `source` is one of the following:
  - `runway` (default) or `replicate`: Assay looks the task up with the merchant's key. Assay does no Replicate generation.
  - `reported`: requires `output_url`, whose exact host must be in `REPORTED_OUTPUT_HOSTS`. The attempt is stored as `SUCCEEDED` with `evidence: merchant_reported`. Billing still needs a stored, decoded file and a verified buyer route.
  - `output_url` on a looked-up source is refused with `output_url_not_allowed`.
- `GET /v1/batches/{id}` now includes `recovered` and `recovered_unit_ids` from the recovery records, so clients don't keep restore state themselves.
- `GET /v1/batches/{id}/investigation` returns `used_for_settlement: true` and `current: true` once the batch was settled on that reading. The capture or void changes the records, but the reading stays final rather than becoming out of date.
- `APPROVAL_WINDOW_SECONDS` (30–600, default 45) sets how long an exact-amount proposal stays approvable.

- Registering a task also enqueues `/internal/tasks/archive` in the commerce outbox, in the same transaction. While the task runs, the job answers 503 and is retried with backoff (12 attempts, about 8 minutes). When it succeeds, the output is archived with the fixed key `archive-<attempt>`, so it is stored once. Failed or cancelled tasks end the watch. Set `AUTO_ARCHIVE_TASKS=false` to turn it off.
- Merchant webhooks: `clip.recovered`, `batch.settled` and `batch.voided` are written to the commerce outbox in the same transaction as the state change. They are signed with HMAC-SHA256 (`Assay-Signature: t=…,v1=…`) and retried on 5xx or 429. They are only emitted when `MERCHANT_WEBHOOK_URL` and a 32+ character `MERCHANT_WEBHOOK_SECRET` are set.

Integration walkthrough: [INTEGRATE.md](INTEGRATE.md).

## Merchant platform (12 November)

**Sign-up and keys.**

- `POST /v1/signup` (public, 5 per hour): `{merchant_name, email, invite_code?}` returns `201 {tenant_id, operator_id, api_key}`. The key is shown once. `SIGNUP_MODE` is `closed` (default), `invite` or `open`.
- `GET /v1/account`
- `POST /v1/api-keys {name, scope}`, where scope is `operator` or `integration`. Returns the key once.
- `GET /v1/api-keys` lists prefixes only.
- `POST /v1/api-keys/:id/revoke`

Send a key as `Authorization: Bearer assay_sk_…` to Commerce `/v1/` routes. An `integration` key can open batches, register tasks, preserve output and read. It cannot approve, refund or cancel.

**Buyer sessions.** `POST /v1/buyer-sessions {batch_id, buyer_id}` returns `{buyer_token, expires_at}`. The token, `assay_bt_…`, works for that buyer on that batch's routes for 30 minutes.

**Currencies.** `currency` on a batch is one of USD, EUR, GBP, CAD, AUD or JPY. Amounts are integer minor units of that currency; JPY has none. A batch never mixes or converts currencies. `GET /v1/operations/impact` adds `by_currency`, and its top-level money fields are USD only.

**PayPal button configuration.** `GET /v1/paypal/config` (public) returns `{client_id, environment, intent:"authorize", currencies}` for the PayPal JS SDK. Orders are still created only by `POST /v1/batches/{id}/paypal/order`.

**Merchant's own PayPal account.**

- `GET /v1/merchant/paypal`
- `POST /v1/merchant/paypal/onboarding {return_url}` returns `{action_url}`, the PayPal sign-up link.
- `POST /v1/merchant/paypal/complete {merchant_id}` reads the account back from PayPal before activating it.

These need `PAYPAL_PARTNER_MODE=true`. Without it, every tenant uses the platform's PayPal account. Once a merchant is connected, orders name them as payee and every call carries `PayPal-Auth-Assertion` for that merchant.

**Disputes.** PayPal `CUSTOMER.DISPUTE.*` webhooks, after signature verification, trigger a read-back of the dispute.

- `GET /v1/batches/:id/disputes` returns `{disputes, refunds_paused, evidence}`. `evidence` is the signed delivery statement to attach in the PayPal Resolution Center.
- While a dispute is open, refunds return `409 dispute_open`.
- Merchant webhooks: `dispute.opened`, `dispute.updated` and `dispute.resolved`.

**Storage and AI options.**

- `ARTIFACT_STORE=gcs` with `GCS_BUCKET` stores originals in a private bucket.
- `AI_PRIMARY=vertex`, or `vertex` listed in `AI_FALLBACK_PROVIDERS`, plus `VERTEX_PROJECT` and `VERTEX_CREDITS_CONFIRMED=true`, calls Gemini on Vertex AI as the Cloud service account.

**SDK.** `backend/sdk` is `@assay/node`, a dependency-free TypeScript client. It requires idempotency keys on every write and includes `verifyWebhook`.
