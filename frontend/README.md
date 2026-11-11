# Paid video delivery frontend

**11 November update.** The frontend was rebuilt around an investigation workspace, a buyer delivery view and a public landing page. Design rules: root DESIGN.md. What was built and verified: product/FRONTEND_HANDOFF_2026_11_11.md. Sections below this one are historical where they disagree.

## Quick start

```bash
cd backend && npm ci && npm run provision   # once
cd ../frontend && npm ci && npm run demo:ui
```

Open the printed URL. This runs the five fixture services and the UI on loopback with fixture AI, fixture PayPal and a labeled synthetic clip. No keys, network or money. Without the backend, `npm run dev` and the landing page's walkthrough run the same screens on an in-browser simulator with example records.

Structure: `src/Workspace.jsx` (router and task pages), `src/case/` (investigation workspace, model, data hook), `src/buyer/`, `src/landing/`, `src/demo/simulator.js` (walkthrough only), `src/ui/kit.jsx` (chips, references, dialog, screening player), `src/styles/system.css` (state tokens).

Checks: `npm test` (22), `npm run build`, `npm run test:sites` (4).

**10 November update:** the user-selected Quiet ledger direction replaces the earlier third-design styling described historically below. See root DESIGN.md, product/QUIET_LEDGER_DIRECTION.md and review/polish-2026-11-10/MOTION_REVIEW.md. Current app includes queue/create/agreement, buyer delivery, payment journal/refund review, original tasks, support, account/privacy and operations. Production-shaped authentication is implemented under backend/src/web but requires external OIDC configuration and verification. No deployment performed.

The fixture harness also supports `partial-recovery --real-ai`: actual hosted models inspect synthetic provider observations while payment/media remain fixtures. Current browser flow recovered one archived clip, reviewed40USD and confirmed fixture capture. No paid inference/provider generation is implied.

The remainder records the initial selected-screen pass; newer completion evidence above takes precedence.

The user-selected third design, implemented as a responsive React application. The selected reference is preserved in `review/reference.png`; screenshot comparisons and interaction evidence are under `review/`. The prior `starter/` application is unchanged.

## Run locally

```powershell
cd "E:\Claude Code Projects\Paypal\frontend"
npm install
npm run dev -- --port 5173 --strictPort
```

Open http://127.0.0.1:5173/. The initial visual demo matches the selected contact-sheet design. Its coastal photograph and still-based six-second video are **illustrative assets**, not provider-generated video or proof of recovery. The eight-of-ten batch, cited explanation and simulated capture are visibly marked demo data. No external API call or money movement occurs in this mode.

## Connected local domain flow

In a separate terminal, start the backend fixture services:

```powershell
cd "E:\Claude Code Projects\Paypal\backend"
npm run frontend:fixtures -- partial
```

Choose **Demo data → Connect local backend**. The Vite development server proxies Commerce at 127.0.0.1:4200 and Delivery at 127.0.0.1:4202. The backend must have been provisioned using its existing instructions. No credential values belong in frontend source or browser storage.

Fixture scenarios:

- `partial`: eight published files in a ten-unit $50 contract; reviewed final $40 capture.
- `recovery`: one archived but unpublished original file; investigate, restore, refresh evidence, retrieve and review.
- `zero`: no eligible output; review release of the authorization, with no refund claim.

Restarting a fixture resets its data. These services use **fixture AI, fixture PayPal and synthetic media**. The frontend sends actual HTTP requests through the five-service domain implementation; that fact does not turn the underlying fixtures into real provider or PayPal receipts.

The local session helper is a development convenience. It mints short-lived role tokens using existing private backend keys on the server. Tokens stay in JavaScript memory; signing keys never enter the client. The helper rejects foreign hosts and cross-origin browser requests, and is absent from the build and production Worker. **Never expose this development server, session helper or fixture backend publicly.** It is not a replacement for production authentication.

For an existing real local stack, the dev proxy targets can be set explicitly through `PVD_COMMERCE_URL` and `PVD_DELIVERY_URL`. Choose trusted loopback services only. The frontend does not complete an initial buyer PayPal checkout/return yet; connect to an already-authorized batch. A real Sandbox approval must be performed by the user. Frontend real-Sandbox execution was not tested in this pass.

## Implemented behavior

- Responsive contact sheet, selected clip, actual video playback, seek, mute and fullscreen.
- Merchant review and buyer-view preview, private authenticated media Blob loading and download.
- Source-linked evidence dialog, delivery agreement, batch chooser, help and environment selector.
- Backend investigation polling/adoption, original-file restoration and refreshed assessment.
- Exact server preview validation, eligible-unit review, expiring approvals and confirmed/pending/unknown distinctions.
- Stable financial request identity across retries, no replacement charge after an ambiguous approval, and explicit reconciliation.
- Keyboard-operable semantic controls, native modal focus containment, focus restoration, accessible dialog names and reduced motion styling.

Financial authority remains on the backend. Client calculations explain the current delivery; they do not authorize capture. Review submission binds the server proposal and digest. Eligible files remain accessible before capture under the existing contract.

## Verification

```powershell
npm test
npm run build
npm run test:sites
```

See [design QA](design-qa.md) for visual comparison, browser verification, exact evidence and limitations. No deployment was performed. Build metadata/Worker support comes from the Product Design template; API integration and production authentication require an appropriate hosted gateway before commercial launch. A successful static build does not establish production readiness.

## Structure

- `src/App.jsx`: merchant/buyer review surface, media controls and workflow dialogs.
- `src/api.js`: same-origin authenticated transport and per-intent request identities.
- `src/domain.js`: financial display-state and review validation functions.
- `src/styles.css`: selected design tokens and responsive styles.
- `vite.config.mjs`: development-only loopback service/session bridge.
- `tests/domain.test.mjs`: money-state, allocation and expiry checks.

## Assets and licenses

UI typography: self-hosted Instrument Sans Variable, OFL-1.1, supplied by Fontsource. Icons: Phosphor React, MIT. The silver mark and coastal photograph were produced for the selected mockup; contact-sheet thumbnails are extracted from that exact generated reference. The demo MP4 is a six-second still-based encoding of the illustrative photograph, without an inference-provider call. Original generated files remain preserved outside the frontend. No Liquid Glass, ShaderGradient or Paper liquid-logo source was imported. The playback material is CSS over semantic controls.
