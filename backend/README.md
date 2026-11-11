# Assay backend

Five service-owned domains: Commerce, Provider, Delivery, Investigation and Payments. The product recovers original short AI-video outputs, verifies technical validity and purchaser retrieval, and settles the immutable unit contract through PayPal Sandbox. AI investigates evidence; deterministic authority controls money. The frontend lives in `../frontend`.

## Run locally

Requirements: Node 22.20+ compatible with package-lock.json, npm, FFmpeg and FFprobe on PATH. From backend:

```powershell
npm ci
npm run provision
npm run preflight
npm run dev
```

Provisioning preserves existing keys and creates private development identity/demo configuration in .local. The five services listen on loopback ports 4100–4104 and own separate persistent embedded PostgreSQL data directories. Local files are a development convenience, not an OS isolation boundary. Stop the runner with Ctrl+C; preserve data during unknown external operations.

Keep integration credentials in backend/.env; scripts also read the existing Gemini key from the parent .env. Do not paste or commit secrets. The launcher passes each provider's secret only to its owning service. Gemini is primary, with optional Groq and NVIDIA Nemotron fallbacks. No local model is used. AI_ZERO_COST_ONLY defaults true: confirm each project's free tier and disabled paid billing before setting its *_FREE_TIER_CONFIRMED flag true. Without an admitted model, new investigations wait safely. Paid video generation remains disabled by ALLOW_PAID_INFERENCE=false.

Service readiness is at /ready, process liveness at /health, OpenAPI at /openapi.json. Readiness reports configured integrations, not a successful external transaction. Issue short-lived private demo tokens with `npm run token`; never copy their output to public artifacts. See scripts/token.ts for arguments. Authenticated tenant-scoped operator diagnostics are at /v1/operations/health. External calls use the Commerce API; internal routes require service identities.

## Verify

```powershell
npm run verify:local
npm audit --audit-level=high
```

The local gate runs strict typing, fixture/domain/API/failure tests, a separate native PostgreSQL integration, build and OpenAPI export. It makes no external inference/payment calls. Public redacted results are in evidence/local-quality.json; detailed logs remain private in .local. Native PostgreSQL checks actual pooled concurrency, RLS, refund constraints, lease fencing, encrypted database restore and restart durability. The fixture suite is not an actual PayPal/provider receipt or production capacity test.

External checks are separate, and consume only configured access:

```powershell
npm run integration:paypal-auth
npm run integration:gemini
npm run integration:workflow-ai
npm run integration:paypal-lifecycle -- prepare
```

The AI workflow check uses real admitted inference over explicit video/payment fixtures. The lifecycle check writes sandbox order approvals privately under .local, requires actual buyer approvals, and refuses to blindly repeat uncertain writes. `settle` runs its adapter-level partial capture/refund/void gate after approval; it does not establish a full product workflow. Never use these scripts against live funds: the PayPal adapter is pinned to Sandbox.

## Deployment and operations

[Architecture](docs/ARCHITECTURE.md), [API](docs/API.md), [verification](docs/VERIFICATION.md), [security review](docs/SECURITY_REVIEW.md), [operations](docs/OPERATIONS.md), [integration access](docs/INTEGRATIONS.md) and [hosting/cost decision](docs/HOSTING_AND_COST.md) are the implemented source of truth. The older modular diagram is historical.

[Compose](infra/compose.yaml), [Render template](infra/render.yaml), [Dockerfile](Dockerfile) and [CI template](infra/ci.yml) are supplied. `node --import tsx scripts/provision-compose.ts` creates private credentials and per-database initialization SQL; --refresh-schema updates initialization SQL while preserving credentials. It does not migrate existing volumes. Use the migration script and restricted runtime roles for established databases. Docker engine execution and cloud rollout remain unverified.

Production media decoding requires the separate capability-protected verifier. Compose isolates it from business credentials and external networking. Delivery currently uses one private persistent filesystem volume; shared object storage and media backup are needed before horizontal scaling. Encrypted logical service database snapshots are available with `npm run backup`; see OPERATIONS.md for key custody, empty-target restore and strict limits.

Normal completion requires both valid AI assessment and confirmed PayPal state. Reads, preserving outputs, reconciliation and safe release remain available during outages. A $50 authorization with eight eligible $5 units produces one final $40 capture; $10 unused is not a refund. Pending is not paid. Unknown writes retain their original identity and require read-back or operator correlation.

No cloud deployment, live payment, commercial availability or proven market adoption is claimed. External identity/onboarding, actual provider output, Sandbox lifecycle/callback receipts, complete cross-service/media recovery, external alerts, measured load and pilot economics remain launch gates. Use the current verification report for exact evidence instead of treating templates or local tests as production certification.
