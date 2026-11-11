# Integrate Assay into an AI-video app

For an app that already generates video with its own provider account and wants to:

- stop paying twice for clips that were rendered but never delivered, and
- charge each buyer through PayPal only for clips they can actually open.

You keep your provider, your prompts and your generation code. Assay sits beside them. It needs to know three things: what the buyer agreed to, which provider task belongs to which clip, and when to settle.

## Before you start

| What | Where |
|---|---|
| PayPal business account (Sandbox first) with partial capture enabled | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID` |
| Your provider, one of the three supported sources | Runway: `RUNWAY_API_KEY`. Replicate: `REPLICATE_API_TOKEN`. Anything else (fal, Veo, Luma, Kling, self-hosted): list your output hosts in `REPORTED_OUTPUT_HOSTS` |
| Free-tier AI key for investigation and buyer-message reading | `GEMINI_API_KEY` (Groq and NVIDIA optional fallbacks) |
| An operator signing key | `npm run provision` creates one; production uses OIDC through the web gateway |

Assay never generates on Replicate or a reported provider. It only reads the task you registered. On Runway, generation from Assay is off unless `ALLOW_PAID_INFERENCE=true` and capped.

## Step 1: open a batch when the buyer checks out

```http
POST /v1/batches                         (operator)
Idempotency-Key: order-8812
{ "buyer_id": "…", "unit_count": 10, "unit_price_minor": 500, "currency": "USD",
  "prompt": "Ten 5-second clips of a quiet coastline at dawn" }
```

The buyer then accepts the immutable contract and approves PayPal for the ceiling ($50 here):

```http
POST /v1/batches/{id}/consent            (buyer)  { "contract_hash": "…" }
POST /v1/batches/{id}/paypal/order       (buyer)  → approval link
POST /v1/batches/{id}/paypal/authorize   (buyer)  after PayPal approval
```

Nothing is charged at this point. PayPal holds an authorization.

## Step 2: register each provider task as you submit it

Call this right after your provider accepts a job, before you wait for its result:

```http
POST /v1/batches/{id}/tasks              (operator)
Idempotency-Key: unit-3-task
{ "unit_id": "…", "source": "replicate", "provider_task_id": "pred_abc123" }
```

| `source` | What Assay does |
|---|---|
| `runway` (default) | Looks the task up with your Runway key |
| `replicate` | Looks the prediction up with your Replicate token. Output must come from `replicate.delivery` |
| `reported` | Needs `output_url` too. The URL's host must be in `REPORTED_OUTPUT_HOSTS`, or the call is refused with `unsafe_output_origin` |

You don't need to watch the task. Registration starts a watcher in the same transaction. It polls with backoff for about eight minutes and archives the output the moment the task finishes. You can also archive one explicitly:

```http
POST /v1/batches/{id}/preserve           (operator)  { "attempt_id": "…" }
```

Assay downloads the file from the allowed host, checks DNS against private addresses, caps the size, and decodes it in the isolated verifier. It keeps the original privately. A provider deleting its copy an hour later no longer matters.

If your callback, worker or download step fails, nothing is lost. The task is registered, so investigation finds the finished render and restores it instead of re-rendering:

```http
POST /v1/batches/{id}/investigate        (operator)  {}
POST /v1/batches/{id}/recover            (operator)  { "artifact_id": "…", "assessment_id": "…" }
```

## Step 3: settle once

```http
POST /v1/batches/{id}/closure-preview    (operator)  {}   → exact amount, expires in 45 s
POST /v1/batches/{id}/approve            (operator)  { "proposal_id": "…", "approval_digest": "…" }
```

Assay captures exactly the verified clips in one final partial capture: 8 of 10 clips at $5 gives $40, and the remaining $10 is released. If no clip was verified, it voids. The buyer's PayPal record carries a per-clip note, and `GET /v1/batches/{id}/statement` returns a signed statement they can check against `GET /v1/statements/keys`.

A buyer message ("clip 8 never came, refund everything") goes to `POST /v1/batches/{id}/support`. AI reads it into cited clip claims, and rules answer from your records. Nothing is refunded or charged automatically.

## Events to your app

Set `MERCHANT_WEBHOOK_URL` (https) and `MERCHANT_WEBHOOK_SECRET` (32+ characters). Assay POSTs JSON for each event:

| Event | When |
|---|---|
| `clip.recovered` | An original was restored instead of re-rendered |
| `batch.settled` | PayPal confirmed the one capture (amount, clips charged of total, statement path) |
| `batch.voided` | Nothing qualified; the authorization was voided |

Each request has the headers `Assay-Event-Id`, `Assay-Event-Type` and `Assay-Signature: t=<unix>,v1=<hex>`. The `v1` value is HMAC-SHA256 of `<t>.<raw body>` with your secret. Verify it, reject timestamps older than 5 minutes, and dedupe on the event `id`. Delivery is at least once:

- A 5xx or 429 is retried with backoff for up to 12 attempts.
- Any other 4xx stops delivery of that event.

`verifyWebhook` in `src/core/webhooks.ts` is a reference implementation.

## What Assay guarantees and what it doesn't

- **Guaranteed:**
  - One capture per batch. A repeated request with the same idempotency key returns the first result.
  - Never more than the authorization.
  - Never a charge for a clip without a stored, decoded file and a verified buyer route.
  - AI never sets an amount, approves, or moves money.
- **Your responsibility:** registering tasks when you submit them (step 2) and keeping `REPORTED_OUTPUT_HOSTS` tight.
- **Not yet available:**
  - Self-serve signup and API keys; tenants are provisioned by the operator today.
  - A packaged SDK.
  - Hosted multi-tenant service.

  See [product/REAL_USER_READINESS.md](../../product/REAL_USER_READINESS.md).
