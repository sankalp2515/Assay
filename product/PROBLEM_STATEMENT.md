# Problem statement (recovery-first), 10 November 2026

This supersedes the earlier operator-first framing for judging and the submission. The scope and the invariants in AGENTS.md are unchanged.

## One line

AI-video apps lose money twice when a render "fails". They pay the provider again for a video that already exists, or refund a customer for work that was actually done. We find the finished video, prove the buyer can open it, and charge through PayPal only for the clips the buyer actually got.

## The person who pays

Maya runs a small shop and orders 10 short promo clips from an AI-video app for $5 each. PayPal shows "up to $50" and she approves.

Seven clips arrive. Clip 8 was finished by the provider, but the message that should have delivered it was lost. Clips 9 and 10 failed.

Today Maya is usually charged for all 10, or gets credits she has to ask for. The app has two options for clip 8:

- pay to render it again, or
- refund a clip it actually made.

She writes: *"Clip 8, 9 and 10 never showed up, refund me everything."*

**With this product:**

- AI reads her message and works out which clips she means and what is wrong with each.
- Rules check the real records. Clip 8 exists, so it is restored without being made again. Clips 9 and 10 don't exist, so they won't be charged.
- Her request to "refund everything" is flagged for the merchant and acted on by no one automatically.
- The merchant reviews one exact amount, and PayPal captures **$40 once**.
- Her PayPal record says *"Charged $40.00 for 8 of 10 clips delivered. $10.00 of your $50.00 authorization was not taken."*
- She gets a signed statement listing every clip, its fingerprint and whether it was charged.
- The unused $10 is never taken, so she has nothing to chase.

## Why this is real

- **Lost results are designed into the ecosystem.** Three major generation APIs document that output disappears unless the app copies it in time:
  - Runway: result URLs expire within 24–48 hours ([docs](https://docs.dev.runwayml.com/assets/outputs/)).
  - Google's Veo in the Gemini API: generated videos are removed from the server after 2 days ([docs](https://aistudio.google.com/docs/veo)).
  - Replicate: API output files are deleted after one hour by default ([docs](https://replicate.com/docs/topics/predictions/data-retention)).

  A missed callback, a crashed worker or a late download turns a finished, paid-for video into one the buyer never sees.
- **Buyers report it.** There are public posts about paying for failed or missing AI generations and chasing credits (Venice, HeyGen and Google Flow threads in [PUBLIC_SOURCES.md](PUBLIC_SOURCES.md)). These are user reports, not a measured incident rate.
- **Counterevidence, handled.** Runway and HeyGen already return credits when generation *errors*. That doesn't cover the cases here:
  - the render succeeded but delivery failed
  - the link expired
  - a batch was only partly delivered
  - the buyer paid the app with real money, not provider credits

## What makes this different

| Others in the field | What they do | What only this does |
|---|---|---|
| OfferSDK | Broad PayPal billing: pricing, subscriptions, entitlements, metering, MCP, checkout recovery | Recovers *already generated output* before anyone pays again, and settles per clip against proof of delivery |
| ServicePromise AI, Fairshake, Verifund, AI Contractor Pal, pay-on-proof escrows | AI judges the work; PayPal holds money and releases it on proof | AI never judges or releases money. It reads messy evidence and the buyer's words; rules decide; PayPal moves an exact amount once |
| Generic "refund failed renders" | Refund after the fact | Recover first; never charge what wasn't delivered, so nothing needs refunding |

There are three concrete differentiators, and each is built and tested:

1. **Recovery before re-render.** An original that exists but never reached the buyer is restored and verified, and the avoided re-render is recorded.
2. **The buyer's own words, read by AI and decided by rules.** The model returns clip numbers and literal quotes, and validation rejects anything it can't support. On 30 held-out messages with real Gemini it scored 18/30 against a keyword baseline's 15/30, or 18/23 against 11/23 on the cases Gemini answered (`backend/evidence/claim-reading-evaluation.json`).
3. **Proof the buyer can keep.** PayPal's own transaction note carries the per-clip outcome, and a signed per-clip statement can be checked by anyone with the public key.

## Social impact

- **Fairer for small buyers.** Creators and small businesses pay only for clips they can open, with no credit chasing.
- **Less wasted compute.** Restoring an existing render instead of generating it again avoids a second GPU run. The system counts each avoided re-render; we don't claim an energy figure we haven't measured.
- **Every charge explained.** Each charge comes with a plain-language reason and a statement the buyer can verify independently. That matters more as AI does more of the work: trust has to be shown, not asked for.

## Business impact (illustrative; not measured)

**For one lost-but-finished $5 clip, without recovery the merchant either:**

- refunds $5 and has still paid the provider for the original, or
- pays the provider again for a duplicate render and absorbs the support time.

**With recovery:** the merchant keeps the $5, makes no second provider call, and the message is answered automatically.

**For buyers:** two failed clips in the example are simply never charged ($10 not taken), so there is no refund cost or dispute.

**Pricing hypothesis:** a monthly base per merchant plus a fee per investigated incident. This is unvalidated: no merchant has been asked yet.

`GET /v1/operations/impact` reports the merchant's own numbers: clips recovered, estimated re-render cost avoided (using the merchant's configured cost), and amounts authorized, charged and never taken. These are reported from records, not projected.

## Scope

The first case is short AI-video batches, one merchant, USD and one provider. The pattern underneath applies to any asynchronous AI work delivered in units:

1. recover what exists
2. verify the buyer can open it
3. authorize a ceiling
4. capture only what was delivered

Video is where the losses are clearest, because outputs are expensive and links expire.

## Name

The public name is **Assay**, decided 11 November 2026, with the descriptor "AI outcome assurance". To assay something is to test it before you pay for it, which is what happens to every clip before PayPal captures. "Paid video delivery" was the working title and survives only in internal identifiers (package and Compose project names). An unrelated AI SEO product also uses the word (assay.wiki), so public copy pairs the name with "for video delivery" or the descriptor.
