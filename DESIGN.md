---
name: Assay
description: Paper, ink and one proof blue. A serif voice for conclusions, a mono voice for evidence, and a six-station proof line that carries every state.
source: The user's Assay concept (assay-standalone.html), adopted 11 November 2026. Supersedes Quiet ledger.
colors:
  paper: "oklch(96.8% 0.009 85)"
  paper-deep: "oklch(93.5% 0.013 85)"
  card: "oklch(98.5% 0.005 85)"
  ink: "oklch(19% 0.012 60)"
  rule: "oklch(86% 0.013 85)"
  muted: "oklch(47% 0.013 60)"
  proof: "oklch(49% 0.17 258)"
  verified: "oklch(50% 0.11 158)"
  inferred: "oklch(72% 0.13 75)"
  inferred-ink: "oklch(48% 0.1 70)"
  broken: "oklch(57% 0.19 32)"
  pending: "oklch(52% 0.03 245)"
  darkroom: "oklch(15.5% 0.008 60)"
  safelight: "oklch(66% 0.16 48)"
typography:
  display: "Instrument Serif 400, line-height 0.98, tracking -0.015em, italic for the turn of the sentence"
  interface: "Geist Variable 400/500"
  data: "Geist Mono Variable; eyebrow 11px, uppercase, tracking 0.14em"
rounded: { control: "6px", sheet: "10px", chip: "4px", pill: "999px" }
---

# Design system: Assay

**Meaning is never decorative.** The product investigates whether paid AI work was delivered, recovers what exists and proves the charge is right. The interface is a printed case file: warm paper, ink, hairline rules, and a single blue that means proof.

Tokens live in `frontend/src/styles/assay.css`. Every token switches between **Paper** (light) and **Darkroom** (dark) through `:root.dark`; the choice is stored as `assay-theme`.

## Principles

1. **Follow the thread.** Agreement, payment, execution, artifact, delivery, settlement. Every case screen shows the six-station proof line, and the station where the chain breaks is the one that pulses.
2. **Facts in ink. Guesses in hatching.** Observed records are solid and tagged `OBSERVED` in ink. AI output sits on amber diagonal hatching with a dashed border and an `AI INFERENCE` tag. The two never share a container style.
3. **Two channels for every state.** Colour plus line style or label, so state survives colour blindness, grayscale and reduced motion.
4. **Blue commits, ink navigates.** The proof-blue button is the action that advances the case. Ink buttons open things. Outline is secondary.
5. **A hold is not a charge. Uncaptured is not a refund.** Each has its own word everywhere it appears.
6. **The darkroom is for media.** Delivered files play on the dark surface. Marketing statements may borrow it for one band; nothing else does.

## Colour roles

| Role | Token | Carries | Second channel |
| --- | --- | --- | --- |
| Paper / paper deep / card | `--paper`, `--paper-deep`, `--card` | Page, quiet fills, sheets | |
| Ink | `--ink` | Type, facts, selected navigation | |
| Rule | `--rule` | Hairlines | |
| Proof | `--proof` | The thread, verified stations, primary actions, captured money | Solid line, check glyph |
| Verified | `--verified` | A claim backed by a source | Check, word |
| Inferred | `--inferred`, `--inferred-ink` | AI hypothesis only; approval required | Hatching, dashed border |
| Broken | `--broken` | Observed failure, the break | Dashed line, cross, pulse |
| Pending | `--pending` | Waiting on a system or a person | Dotted line, hollow node |
| Darkroom / safelight | `--darkroom`, `--safelight` | Media, the recovery reveal | |

Legacy names from earlier stylesheets (`--line`, `--surface`, `--accent`, `--confirmed`, `--authorized`…) are aliased to these, so older task pages inherit the system. Green ledger and violet AI colours are retired.

## Typography

| Voice | Face | Use |
| --- | --- | --- |
| Display | Instrument Serif 400 | Page titles (`clamp(2.4rem, 4.2vw, 3.4rem)`), landing hero (up to 6.6rem), sheet titles, big answers and amounts in prose. Italic marks the turn: *The video exists.* |
| Interface | Geist 400/500 | Body 14px, lead 15–16px, controls 13px |
| Data | Geist Mono | Amounts, times, IDs, sources; `.eyebrow` for labels |

Every page opens with the same header: eyebrow path, serif headline that states the situation as a sentence, one muted lead, actions on the right, a rule below. Amounts never animate.

## Components

- **Proof line** (`ui/ProofLine.jsx`): six nodes on a thread. Verified is a filled blue node and solid link; pending a hollow node and dotted link; broken a red node, dashed link and pulse; unknown a dashed hollow node. Sizes: full (selectable stations), plain, and `mini` for table rows.
- **Sheet** (`.sheet`): card colour, 1px rule, 10px radius, `--shadow-sheet`. Header row with a rule beneath.
- **Tags**: `.tag-observed` (ink fill), `.tag-inferred` (amber dashed), `.tag-env` (where the records come from: Sandbox, test fixtures, illustrative).
- **Source line** (`.source`): `↳ provider.tasks` in mono under any claim.
- **Chip**: 4px radius status with glyph and word; AI and neutral use dashed borders.
- **Evidence row**: time, title and source, tag. Failures carry a red left rule; inferences sit on hatching.
- **Recovery plan**: numbered steps on a vertical rule, each marked `AUTOMATIC` or `NEEDS YOU`; locked steps show a lock.
- **Settlement**: unit strip (included clips framed in blue, excluded hatched with a dashed red border), capture bar (blue fill for the capture, hatched remainder), summary rows with the proposed capture highlighted.
- **Darkroom card**: media player, four checks, file facts.
- **Buttons**: `.btn-proof`, `.btn-ink`, `.btn-outline`; 36px, 44px large, 32px small.

## Layout

App shell: 240px sidebar (brand, Merchant workspace, Records, What the customer sees, merchant footer) and a 58px top bar with the environment tag and theme toggle. Content max 1240px, 28px gutters. Under 1024px the sidebar becomes a scrolling tab row. Buyer pages drop the sidebar and carry the merchant's name with "Delivery verified by Assay". Landing max 1240px with 104px section rhythm.

## Motion

| Motion | Where | Spec |
| --- | --- | --- |
| Draw | Proof line | Links reveal left to right with `clip-path`; workspace 300ms, 60ms stagger; landing 600ms, 120ms stagger |
| Pulse | Broken node only | Opacity, 2.4s. Nothing else blinks |
| Develop | A recovered file, first appearance only | 3.2s from amber darkness |
| Enter | Landing and buyer first view only | 8px rise, 400ms, 60ms stagger |
| Press | Buttons, pointer only | scale 0.97, 100ms in, 160ms out |

Curves: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-draw: cubic-bezier(0.77, 0, 0.175, 1)`. Workspace pages appear at once; they are opened many times a day. Hover movement is gated to fine pointers. Under reduced motion, movement, loops and the long reveal are removed while colour and opacity changes remain.

## States

Loading: pulsing skeleton blocks. Empty: a serif sentence and one action. Failed request: red-ruled banner that names the step. Pending or unknown payment: pending or hatched chip with "Pending is not paid" or "do not submit a replacement". Expired approval: the confirm button is replaced by a fresh review request. Stale AI reading: banner and disabled proposals. Missing or refused file: the darkroom states the cause.

## Accessibility

Text roles meet 4.5:1 on their fills in both themes by construction of the token pairs; verify with a contrast tool before release. One `h1` per screen, real tables and lists, native dialogs, a 2px proof-blue focus ring, live regions for progress. No horizontal page scroll at 375px; wide tables scroll inside their sheet.

## Do and don't

**Do** state the situation in the headline; cite a source under every claim; keep AI on hatching; show the PayPal reference beside confirmed money.

**Don't** use blue for decoration; put AI output in a solid container; show a hold as a charge; animate inside the workspace on navigation; add gradients, glass or glow.
