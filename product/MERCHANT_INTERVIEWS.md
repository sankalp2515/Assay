# Merchant conversations kit

12 November 2026. No merchant has been interviewed yet. Software can't close this gap; it needs you to talk to people. This kit makes each conversation short, comparable and honest, so the results can go in the README as evidence.

## Who to talk to

Aim for five conversations, 20 minutes each. Look for:

- Founders or engineers at apps that **sell generated video per clip or per batch**: ad creative tools, social clip generators, product-video tools, AI avatar apps.
- People who run on **Runway, Replicate, fal, Veo or Luma** and handle their own billing.
- Indie builders posting about failed renders, refunds or webhook problems on X, Reddit (r/SaaS, r/StableDiffusion, r/aivideo), Indie Hackers, and the Discords of Replicate or fal.

Skip anyone who only uses a consumer app; they don't run the pipeline.

## Outreach message

> Hi <name>, I'm building a small tool for AI-video apps: when a render finishes but never reaches the customer (expired output URL, failed webhook, worker crash), it recovers the original instead of re-rendering, and charges the buyer through PayPal only for clips they actually got. Could I ask you five questions about how you handle failed or missing renders today? 15–20 minutes, no pitch. Happy to share what I learn from other builders.

## Questions

Ask them in this order. Don't show the product until question 5.

1. **Last time.** "Tell me about the last time a customer said a video never arrived or was broken. What happened, step by step?"
2. **Frequency and cost.** "Roughly how often does that happen per week? What do you do: re-render, refund, credit? Who pays the provider for the second render?"
3. **Root cause.** "When it happens, was the render actually finished at the provider? How would you know? How long does your provider keep outputs?"
4. **Billing model.** "Do you charge up front, per clip, or by subscription? Has a customer ever disputed a charge or asked for a refund for clips they did get?"
5. **Reaction.** Show the 30-second story from the README. "Which part, if any, would you use? What would stop you?"
6. **Commitment.** "If this ran against your Sandbox for a week, would you try it?" Note whether they answer yes, maybe, or give a reason not to.

## What to write down

One row per conversation. Keep their words; don't paraphrase into what we hope to hear.

| Field | Example |
|---|---|
| Date, role, product type, provider | 14 Nov, CTO, ad-creative tool, Replicate |
| Monthly clips (their estimate) | ~20,000 |
| Lost or broken deliveries per week (their estimate) | "maybe 30" |
| What they do today | Re-render and eat the cost |
| Was the output still at the provider? | "Usually, but the URL had expired" |
| Billing model | Credits bought up front |
| Strongest reaction (quote) | "Recovering instead of re-rendering is the bit I'd pay for" |
| Blocker (quote) | "We don't use PayPal" |
| Next step agreed | Sandbox trial / none |

## How to use the results

- Put the table, anonymized, in `product/` and link it from the README's Limits section. Replace "No merchant conversations yet" only with what was actually said.
- If three of five say PayPal isn't their processor, that is a named failed assumption. Note it and say so; don't hide it.
- Count only explicit trial agreements as demand. "Sounds cool" doesn't count.
