# Frontend handoff

## Local connection

From `backend`, run `npm run provision` if the local identities are missing. For UI development, run `npm run frontend:fixtures -- recovery`, `-- partial`, or `-- zero`. Commerce is on `127.0.0.1:4200`, Delivery on `127.0.0.1:4202`. The runner prints the fixture batch ID. It starts from an authorized batch and resets on restart. Recovery has one archived, unpublished file. Partial has eight published clips out of ten. Zero has no deliverable clips. Payment and AI responses in this runner are fixtures and require no external calls.

Use `npm run token -- operator` or `npm run token -- buyer` to issue a short-lived token for your local session. The fixture and regular dev servers trust the same local issuer. Tokens expire after two minutes. Treat them as private and refresh after a `401`. Keep signing keys and `.local` files on the server side and outside frontend assets. The buyer ID for creating a batch is in `.local/demo.json`.

For real Sandbox checkout and hosted AI, start `npm run dev` and use Commerce `127.0.0.1:4100` and Delivery `127.0.0.1:4102`. Provider generation in this regular stack requires configured Runway access. Use a same-origin development proxy for the two services. Commerce and Delivery do not enable cross-origin credentials. The fixture runner is intended for localhost UI work and must never be exposed publicly.

## Buyer journey

1. Read `GET /v1/batches/{id}` and display the accepted contract ceiling, unit count, currency, deadline and retention. Money fields are integer cents.
2. Accept the displayed terms with `POST /v1/batches/{id}/consent` and `{ "contract_hash": "…" }`. Request `POST /v1/batches/{id}/paypal/order` with `{}`. On the real stack, navigate to the returned `approval_url` only after checking its Sandbox PayPal origin. The fixture cases start after this stage.
3. After the PayPal return, resume the authenticated buyer session and call `POST /v1/batches/{id}/paypal/authorize` with `{}`. Display authorization and settlement separately. A redirect alone does not change the financial state.
4. Read `GET /v1/batches/{id}/outcomes`. The `artifacts` array contains published files. Request each artifact's `content_path` from Delivery with `Authorization: Bearer <delivery_token>`. A plain `<video src>` cannot add that header. For these bounded files, fetch a Blob, give the video element its object URL, and revoke it when replaced or unmounted. Refresh `outcomes` for a new Delivery token if needed. Treat `409 not_retrievable` as unavailable and `503 artifact_integrity` as an access problem.
5. Show a completed charge only from a confirmed capture. Show void as release of the authorization. If eight $5 clips qualify out of a $50 ceiling, show $40 charged and $10 unused. Show refunds separately against the original capture.

## Operator journey

1. Use `GET /v1/batches` to list and `GET /v1/batches/{id}` to load the contract. `GET /v1/batches/{id}/review` gives operator-only attempt and artifact summaries, including unpublished archive IDs. Join them to the contract by `unit_id`. Provider source URLs stay on the backend.
2. For a configured provider, register an attempt with `POST /v1/batches/{id}/attempts` and `{ "unit_id": "…", "provider_task_id": "…" }` to reuse a known task. Preserve with `POST /v1/batches/{id}/preserve` and `{ "attempt_id": "…" }`. `STORED` may still mean unpublished. `QUARANTINED`, `SUBMISSION_UNKNOWN`, and other unavailable states need explicit review.
3. Start `POST /v1/batches/{id}/investigate` with `{}`. Poll `GET /v1/batches/{id}/investigation` while `RESERVED` or `RUNNING`. Once `VALID`, call `POST investigate` with `{}` to adopt the current assessment. Show cited evidence and suggested action. `INCONCLUSIVE` and `WAITING_FOR_AI` need a distinct review state. An intentional refresh may send `refresh_reason` with a new key.
4. To restore access, send `POST /v1/batches/{id}/recover` with `{ "artifact_id": "…", "assessment_id": "…" }`. Then re-investigate because publication changes the evidence. Never display the AI suggestion as an executed operation.
5. Request `POST /v1/batches/{id}/closure-preview`. Render `action`, `amount_minor`, eligible unit IDs and expiry from the response. Approval is `POST /v1/batches/{id}/approve` with `{ "proposal_id": "…", "approval_digest": "…" }`. The preview lasts 45 seconds. Poll `outcomes` after `SETTLEMENT_REQUESTED` and map `PENDING`, `UNKNOWN` and `NEEDS_REVIEW` to distinct nonfinal states. `CONFIRMED` is the successful financial state. Use `POST /v1/operations/{id}/reconcile` for explicit read-back. Rebuild and review stale previews.

Every POST needs `Content-Type: application/json` and an `Idempotency-Key`. Preserve the key for a retried financial intent. On ambiguous responses use status and reconciliation. Read `{code,message,trace_id,retryable}` on API errors. The exported OpenAPI schemas cover routes and request bodies. Some response schemas remain permissive, so narrow the fields you consume and tolerate additional fields.

See [API contract](API.md), [Commerce OpenAPI](openapi/commerce.json) and [verification](VERIFICATION.md).

## Actual video evidence

`npm run generate:demo-video` uses the fixed public Lightricks Space and resumes an existing local result. It neither purchases credits nor retries an uncertain submission. `npm run verify:generated-video -- --media-only` verifies its source output. `--fixture-paypal` exercises real AI recovery, private buyer retrieval and fixture settlement. A run without either flag prepares a real Sandbox approval using the same clip. When a test stops waiting for approval, approve that same order and run `npm run verify:generated-video -- --resume`. Resume is limited to approval timeout and verifies the original order before authorization. Keep these runners separate from the normal localhost API and retain the private `.local` records.
