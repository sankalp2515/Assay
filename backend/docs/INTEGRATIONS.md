# Integration access and sponsor fit

Updated 8 November 2026. The user approved creation of the test-only US merchant app and confirmed free-tier AI use. Its credentials are saved privately; the original configuration is retained in .local. Actual PayPal Sandbox authorization, final partial capture, original-capture refund and separate void passed through the application adapter with real buyer approvals. These are adapter-level receipts, not the combined product/provider journey. Actual Gemini, Groq and NVIDIA citation/schema checks passed. No live funds, credit purchases or cloud deployment were used. [Sandbox evidence](../evidence/paypal-lifecycle.json) · [AI-provider evidence](../evidence/ai-providers.json)

## PayPal Sandbox

1. Open [PayPal developer applications](https://developer.paypal.com/dashboard/applications/sandbox) and sign in yourself.
2. Select Sandbox, create/open an application associated with your Sandbox Business account, and use its Sandbox Client ID and Secret. Do not use Live credentials.
3. Put PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in backend/.env. Set PAYPAL_MERCHANT_ID to that sandbox business account's merchant ID. The merchant ID is not the client ID or email address.
4. Under sandbox test accounts, use a Personal account as the buyer. Complete the actual approval link returned by the order endpoint. Buyer approval cannot be fabricated by the backend.
5. Confirm partial-capture capability for the account, then test the $50 authorization/$40 final capture, separate zero-output void, original-capture refund and resource read-back. Sandbox funds are fictional, but resource receipts must be actual API responses.
6. For callbacks, expose the Payments HTTPS /v1/paypal/webhooks route through an approved deployment/tunnel, register needed events, and store PAYPAL_WEBHOOK_ID. Keep MERCHANT_TENANT_ID mapped to the configured merchant tenant. An unsigned callback is rejected.
7. Run npm run preflight to check variable presence. This does not authenticate the account. Record only redacted resource IDs/status/amount/currency/payee and digests in evidence after actual tests.

The adapter is hardcoded to https://api-m.sandbox.paypal.com. Credentials exist only in Payments. Unknown outcomes retain the original operation key and require reconciliation. Missing credentials deliberately prevent normal completion. [Official authorization flow](https://developer.paypal.com/checkout/delay-capture/) · [Account partial-capture requirements](https://developer.paypal.com/payment-methods/auth-honor/)

## AI and video provider

Gemini is configured through an existing root key or GEMINI_API_KEY in backend/.env. Real connectivity and real-model fixture-workflow checks produced evidence files. They do not establish a held-out AI advantage. Each investigation has bounded output/tool calls and a daily assessment admission limit. Keys are passed only to Investigation.

Runway requires RUNWAY_API_KEY from the developer account, provider access and applicable credits. Existing task lookup is supported; new inference requires ALLOW_PAID_INFERENCE=true and remains one attempt per logical unit in P0. Keep it disabled until account/budget capability is confirmed. Paid inference is not free merely because PayPal testing uses sandbox funds. Update the explicit CDN allowlist to the documented output origin returned by that provider; never allow arbitrary user URLs. [Runway API](https://docs.dev.runwayml.com/api/) · [Output storage requirement](https://docs.dev.runwayml.com/assets/outputs/)

## Sponsor assessment

| Sponsor | Credible product role | Credential/status |
| --- | --- | --- |
| Postman | Executable backend API collection and smoke assertions | Collection executed locally with Newman: two requests/four assertions passed. No Postman API key needed for local collection execution. No workspace/API account was created. |
| Render | Host the five services, verifier worker and managed databases | Blueprint template prepared. Account/API key not available, no deployment or credit redemption. Sponsor page provides the credit claim route. |
| Elastic | Optional tenant-scoped search across redacted incident evidence when investigation volume justifies it | No Elasticsearch key/account and no runtime adapter shipped. PostgreSQL remains authoritative. Not claimed as an integration. |
| APIMatic | PayPal context/API contract development tooling | Sponsor page says enabled PayPal context does not need extra APIMatic credentials. No context plugin installed or usage claim made. |
| KERNEL | Later authenticated buyer-browser playback/verification | No key or account. Current backend verifies the authenticated content route; no cloud-browser verification claim. |
| AG Grid | Merchant evidence-comparison UI | Frontend excluded; no integration or license claim. |
| Bryntum | Optional later workflow timeline UI | Frontend excluded; no integration or trial claim. |
| Astropods | Alternative infrastructure hosting | Not selected alongside Render; no account or integration. |
| Channel3 | Shopping/product catalogue data | No necessary role in the selected video-recovery workflow. |
| Zapier | Optional operator notification integration after explicit messaging authorization | No account, webhook or messages sent. |

Official sponsor pages: [Postman](https://paypalaihackathon.devpost.com/details/postman), [Render](https://paypalaihackathon.devpost.com/details/render), [Elastic](https://paypalaihackathon.devpost.com/details/elastic), [APIMatic](https://paypalaihackathon.devpost.com/details/apimatic), [KERNEL](https://paypalaihackathon.devpost.com/details/kernel), [AG Grid](https://paypalaihackathon.devpost.com/details/aggrid), [Bryntum](https://paypalaihackathon.devpost.com/details/bryntum), [Astropods](https://paypalaihackathon.devpost.com/details/astropods), [Channel3](https://paypalaihackathon.devpost.com/details/channel3), [Zapier](https://paypalaihackathon.devpost.com/details/zapier).

Optional sponsors are not required for the competition's PayPal-plus-AI requirement. Do not create unnecessary accounts or present a deployment template as actual sponsor use. Never put API keys in exported Postman collections, screenshots, public environment files or reports.


## Local hardening update, 8 November

Gemini remains primary; Groq and NVIDIA Nemotron fallbacks share evidence/tool validation, preserve valid uncertainty and record provider attempts. The user supplied keys and confirmed free-tier testing. Actual checks passed for gemini-3.1-flash-lite, Groq openai/gpt-oss-120b and NVIDIA nvidia/nemotron-3.5-super-vl-120b-a12b. Earlier fallback defaults returned 404/410 and were replaced after checking provider model listings and official documentation. AI_ZERO_COST_ONLY defaults true and confirmed account flags are configured privately. The refreshed Gemini recovery workflow also passed with one scoped read over explicit media/payment fixtures. No local model is used.

The original India-region Sandbox merchant rejected USD checkout. A separate US test merchant and explicitly approved REST app resolved it. Real buyer approvals, $50 authorization, $40 final capture, $5 original-capture refund and separate $50 authorization/void passed. The current capture read-back is PARTIALLY_REFUNDED because of that deliberate $5 remedy; the capture initially completed. The unused $10 was never refunded. The original credentials and original orders are preserved privately. Webhook registration and actual signed delivery remain unverified; there is no public tunnel or cloud deployment. A full combined journey with actual video-provider output is also open.

Deployment choice: Google Cloud, using Gemini. Current Gemini adapter uses the Developer API key; Vertex AI/ADC and managed deployment are not implemented or claimed. The Render Blueprint remains an alternative reference. See HOSTING_AND_COST.md.


Combined integration gate passed (backend/evidence/service-sandbox-workflow.json): actual Gemini, actual Sandbox buyer approval/authorization and one confirmed $40 capture from the same $50 authorization through the five domain APIs. The original locally generated fixture file was recovered, eight purchaser routes were verified, and one capture journal entry persisted. This test uses authenticated in-process Fastify calls, five persistent PGlite databases, eight fixture MP4s and two fixture failed tasks. It does not establish actual video-provider output, separate-process HTTP e2e, signed callback delivery or commercial production readiness. The initial conservative AI action and reassessment retry failure were fixed without relaxing evidence/money gates or creating a replacement authorization. Explicit refresh_reason preserves the prior investigation; stable observation IDs preserve retry payload identity. The final local suite now passes 34 tests, plus nine native PostgreSQL checks. Frontend and cloud deployment remain excluded/unexecuted.
