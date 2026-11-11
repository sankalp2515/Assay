# Real-user readiness and the OfferSDK comparison

11 November 2026, updated 12 November. This page covers what a real AI-video merchant and their buyers need before they could use Assay, and how Assay stands against OfferSDK, the strongest entry we know of.

## Where Assay sits

OfferSDK answers **"what is this user allowed to do?"** Its plans, entitlements, offers, subscriptions and cancel flows act *before* the work happens.

Assay answers **"what did this buyer actually get?"** It acts *after* the work: it finds output that exists, proves the buyer can open it, and charges through PayPal for exactly that.

The two are complementary. An app could use OfferSDK to sell a plan and Assay to settle each batch against proof of delivery. We don't compete on breadth of billing features. We compete on a question their model can't answer: for AI work that is delivered in pieces and can be lost in transit, was it delivered?

**The broader category.** Video is the first case because outputs are expensive and providers delete them within hours. The same four steps apply to any asynchronous AI work sold per unit, such as image sets, voice tracks, dubbing jobs or agent tasks:

1. Recover what exists.
2. Verify the buyer can open it.
3. Authorize a ceiling.
4. Capture only what was delivered.

The task-source interface (Runway, Replicate, or reported by the merchant) is the seam where those jobs plug in.

## Head to head

OfferSDK repo checked again on 11 November 2026: still at commit `c0be02f` (20 October).

| | OfferSDK | Assay | Who leads |
|---|---|---|---|
| Problem | Pricing and access changes need code and deploys | Finished AI renders are lost and paid for twice; buyers are charged for clips they never got | Different problems. Ours is narrower, but the money loss is concrete and documented by providers |
| PayPal depth | Checkout and full subscription lifecycle | Orders AUTHORIZE, one final partial capture, void, refunds against the original capture, read-back before showing paid, per-clip `note_to_payer` and `invoice_id`. Real Sandbox receipts recorded | Assay on correctness and evidence; OfferSDK on breadth |
| AI role | Picks cancel-save offers within guardrails; dashboard agent proposes catalogue changes | Reads evidence and buyer messages into cited claims. Rules decide, and it has no money tools. Held-out evaluation published, including where AI lost to rules | Assay on honesty and boundedness; OfferSDK on visible "agentic" moments |
| Architecture | Hono on Bun API, Next.js dashboard, Postgres 17 | Five services, five databases with RLS, outbox, isolated media verifier, signed service tokens, 11 containers | Assay |
| Integration | Headless React SDK, signed webhooks, Zapier, `402` responses agents can read | REST API with OpenAPI; self-serve sign-up with scoped API keys and buyer sessions; `@assay/node` server SDK (not yet on npm); task intake for three source types; automatic archiving; signed webhooks; integration guide | Close. OfferSDK has a browser SDK and Zapier; Assay has scoped keys and a server SDK |
| Try it | Hosted site, demo workspace with seeded data, docs site, 2:20 video, one-click Deploy to Render | Local Docker demo with no keys; browser UI on local fixtures | **OfferSDK, by a wide margin. This is the gap that decides judging** |
| Sponsors | Render, Postman | Postman collection exists; nothing claimed | OfferSDK |

**Conclusion.** Assay wins on depth and evidence, and loses today on packaging: hosted URL, demo workspace, video, deploy button. Packaging is what judges touch first, so closing it matters more than any further backend feature.

## What a real user needs

**Done** means built and tested here. **Next** is worth doing before submission. **Later** is after the hackathon.

### Merchant onboarding and integration

| Need | Status |
|---|---|
| Plug in without replacing your provider | **Done.** `POST /v1/batches/{id}/tasks` for Runway, Replicate or any reported provider. Merchant-reported URLs are limited to hosts configured in advance |
| Save output before the provider deletes it | **Done.** A watcher starts with each registered task and archives the output when it finishes |
| Learn about results without polling | **Done.** Signed `clip.recovered`, `batch.settled` and `batch.voided` webhooks through the outbox, retried on failure |
| A three-step guide | **Done.** [INTEGRATE.md](../backend/docs/INTEGRATE.md) |
| Self-serve signup, API keys per merchant | **Done.** `POST /v1/signup` (closed, invite or open), hashed keys shown once, `operator` and `integration` scopes, revocation, buyer sessions. New tenants are registered with every worker |
| Connect the merchant's own PayPal account | **Built, fixture-tested.** Partner Referrals sign-up link, read-back of the merchant integration bound to the tenant, then orders and captures for that merchant with `PayPal-Auth-Assertion`. Needs PayPal to approve this app as a partner before it can run for real; off until `PAYPAL_PARTNER_MODE=true` |
| Packaged SDK (`@assay/node`) | **Done, not published.** `backend/sdk`, no dependencies, typed events, `verifyWebhook`, idempotency keys required. Tested against Commerce |
| Native fal, Google Veo and Luma lookups | Later. They work today as reported tasks; a native lookup removes the need to report the URL |
| Watch for longer than about 8 minutes | Later. A dedicated scheduler for long renders. Investigation and recovery already cover anything finished later |

### Buyer

| Need | Status |
|---|---|
| Pay only for clips received | **Done.** One final partial capture; the rest of the authorization is released |
| Understand the charge | **Done.** Per-clip note on the PayPal record, plus a signed statement anyone can verify |
| Say "clip 8 never came" in plain words | **Done.** AI reads the message into cited clip claims, and rules answer. Nothing is refunded automatically |
| Official PayPal button instead of a redirect link | Next (frontend). PayPal JS SDK with `intent=AUTHORIZE` |
| Email when clips are ready or the batch is settled | Later. The merchant can send this from the webhooks today |

### Money and PayPal

| Need | Status |
|---|---|
| Never more than authorized; one capture only | **Done.** Tested under concurrency on native PostgreSQL |
| Unknown PayPal results stay unknown until read back | **Done.** Reconciliation, no new keys on retry |
| Receive PayPal webhooks in production | Next. Needs a public HTTPS URL; verification is implemented and fixture-tested |
| Authorization lifetime | Batches finish in 30 minutes, inside PayPal's honor period. Longer batches would need reauthorization (Later) |
| Disputes (`CUSTOMER.DISPUTE.*`) | **Done, fixture-tested.** Verified webhook, then a read-back from PayPal, linked to the confirmed capture. Refunds are paused while it is open (no double compensation). The signed statement is offered as evidence, and the merchant gets a webhook. The merchant still answers in PayPal's Resolution Center; Assay doesn't submit evidence |
| Currencies other than USD | **Done.** USD, EUR, GBP, CAD, AUD and JPY. One currency per batch, exact PayPal value strings (no JPY decimals), currency checked on every read-back, impact reported per currency. Only USD has run on real Sandbox |

### Running it

| Need | Status |
|---|---|
| Containers, health checks, non-root, read-only demo | **Done** |
| Hosted URL a judge can open | **Planned, ready to run.** [DEPLOY.md](../backend/docs/DEPLOY.md): one Google Cloud VM on credits running the tested containers, plus the web gateway, demo sign-in and TLS. Render hosts the free landing page. Needs your Google Cloud project |
| Object storage for archived clips | **Done.** Private GCS bucket, create-only writes, service-account auth with no key file. Tested with a fake GCS API, not yet against a real bucket |
| Rate limiting at a gateway, metrics, alerts | Later. Per-process limits and structured logs today |
| External login (OIDC) for operators | Implemented but never run against a real identity provider |
| Backups and restore | Encrypted logical restore tested per database; cross-service and media disaster recovery not tested |

### Commercial

| Need | Status |
|---|---|
| Pricing | Hypothesis: a monthly base per merchant plus a fee per recovered clip. Not validated with any merchant |
| Proof that merchants want it | Provider documentation and public user reports only. No merchant conversations yet. [MERCHANT_INTERVIEWS.md](MERCHANT_INTERVIEWS.md) has the outreach message, six questions and the record format |
| Impact a merchant can see | **Done.** `GET /v1/operations/impact`: clips recovered, estimated re-render cost avoided, authorized vs. charged vs. never taken |

## Order of work for the rest of the hackathon

1. **Hosting:** Render blueprint, a hosted demo with seeded data, and a link in the README. This closes most of the head-to-head gap and claims the Render sponsor prize.
2. **One real Sandbox run through the UI,** filmed. This needs the merchant's own click.
3. **Register the PayPal webhook** against the hosted URL and record one verified delivery.
4. **PayPal button** in the frontend.
5. **Neutral generated clips** for the demo, then the video.
