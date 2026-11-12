# @sankalp2515/assay-node

Server-side TypeScript client for Assay. It has no dependencies and needs Node 20 or newer.

```sh
npm install https://github.com/sankalp2515/Assay/releases/download/v0.1.0/sankalp2515-assay-node-0.1.0.tgz
```

Keep your secret key on your server. Your buyer's browser gets a buyer session token instead: one buyer, one batch, 30 minutes.

```ts
import { Assay, verifyWebhook } from "@sankalp2515/assay-node";

const assay = new Assay({ apiKey: process.env.ASSAY_API_KEY!, baseUrl: "https://assay.example.com" });

// 1. The buyer checks out: open a batch (idempotent on your order id).
const batch = await assay.batches.create(
  { buyer_id, unit_count: 10, unit_price_minor: 500, currency: "USD", prompt },
  "order-8812",
);

// 2. Your provider accepts a job: register it, and Assay archives the output.
await assay.batches.registerTask(batch.id, { unit_id, source: "replicate", provider_task_id: "pred_abc" }, "unit-3-pred_abc");

// 3. Hand your buyer's browser a short-lived token for the PayPal approval page.
const { buyer_token } = await assay.buyerSessions.create({ batch_id: batch.id, buyer_id }, "session-" + batch.id);

// 4. Settle once: preview the exact amount, then approve it before it expires.
const preview = await assay.batches.closurePreview(batch.id, "preview-" + batch.id);
await assay.batches.approve(batch.id, { proposal_id: preview.id, approval_digest: preview.approval_digest }, "approve-" + preview.id);
```

## Webhooks

```ts
app.post("/assay/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const ok = verifyWebhook(process.env.ASSAY_WEBHOOK_SECRET!, req.header("assay-signature")!, req.body.toString());
  if (!ok) return res.sendStatus(400);
  const event = JSON.parse(req.body.toString()); // dedupe on event.id
  res.sendStatus(200);
});
```

Events: `clip.recovered`, `batch.settled`, `batch.voided`, `dispute.opened`, `dispute.updated`, `dispute.resolved`.

## Keys

| Key | Can do |
|---|---|
| `assay_sk_…` with scope `operator` | Everything a merchant operator can, including approving a capture |
| `assay_sk_…` with scope `integration` | Open batches, register tasks, preserve output, read. It cannot approve money |
| `assay_bt_…` | One buyer, one batch, 30 minutes |

Rotate a key by creating the new one, deploying it, then calling `apiKeys.revoke` on the old one.

Errors are thrown as `AssayError` with `status`, `code`, `retryable` and `traceId`. Retry a write only with the same idempotency key.

To build from a source checkout, run `npm ci` in `backend/` and `npm run build` in `backend/sdk/`.
