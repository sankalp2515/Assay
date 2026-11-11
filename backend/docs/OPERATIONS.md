# Operations and deployment

## Local operation

Use npm run provision then npm run dev from backend. Five persistent embedded PostgreSQL engines live in .local/data/{service}; private keys in .local/keys. These are development assets, not a managed PostgreSQL production deployment. Stop the runner with Ctrl+C before filesystem backup or restarting. Existing database directories and keys must be preserved. Never delete them to fix an unknown financial operation.

## PostgreSQL/Compose deployment

Run `node --import tsx scripts/provision-compose.ts` once to produce private .local/compose.env and .local/init/{service}.sql. Each database has a random administrative password and distinct runtime password. SQL creates tenant RLS, app_runtime privileges, immutable audit/journal access and a nonowner runtime login. The generated files contain credentials and are ignored by Git. Do not rotate them by regenerating over a running database.

If preparing an empty deployment after source changes, `node --import tsx scripts/provision-compose.ts --refresh-schema` refreshes initialization SQL while preserving existing credentials. This does not migrate an already initialized PostgreSQL volume. Use a versioned migration job for existing data.

`docker compose --env-file .local/compose.env -f infra/compose.yaml config --quiet` validates configuration without printing secrets. Start with `docker compose --env-file .local/compose.env -f infra/compose.yaml up --build -d` after reviewing local resource use. The Docker engine was unresponsive during initial inspection; the configuration validation succeeded, but image build and actual container startup have not been verified in this session.

The topology has five separate PostgreSQL containers/databases and five domain services. Delivery's isolated decoder receives bounded bytes through a capability-protected API, has no database/provider/payment keys and uses an internal-only Compose network. Resource limits and read-only filesystems apply. Only loopback host ports are exposed. Add a controlled TLS ingress before remote use. Production Delivery refuses local decoding without MEDIA_VERIFIER_URL/token.

For an existing managed database, run the migration job with MIGRATION_DATABASE_URL and SERVICE_NAME. Never give migration credentials to application containers. Create a restricted LOGIN role, grant app_runtime membership, and restrict database CONNECT to the correct service. DATABASE_URL must use that runtime account. Disable AUTO_MIGRATE. New schema changes require a new migration version and compatibility plan, rather than editing applied migrations. The initial files describe a fresh installation; no deployed database migration history is claimed.

## Render

infra/render.yaml describes service/worker boundaries, secret placeholders and one persistent Delivery disk. It deliberately does not purchase or provision databases automatically. Provision private service-owned PostgreSQL databases and restricted runtime accounts, apply migrations, configure each DATABASE_URL, then set PUBLIC_KEYS, SERVICE_URLS, TENANT_IDS, service-specific private keys and integration secrets. Use public HTTPS URLs for Commerce, buyer Delivery and PayPal webhooks; internal service URLs stay private where supported. Validate the Blueprint using Render's documented schema/API before applying. Deployment/pricing review and account access remain pending.

Single persistent Delivery disk supports one replica. A shared private object-store adapter and independent backup are required before horizontal Delivery scaling. Media storage growth dominates the small text API workload. No Kubernetes/service mesh is needed for this prototype. [Render Blueprint reference](https://render.com/docs/blueprint-spec)

## CI/CD and rollback

infra/ci.yml is a workflow template because the workspace is not a Git repository. It installs from the lockfile, checks types, tests APIs/failures, builds, audits dependencies and exports API contracts. Do not upload .env, .local, private Newman reports, root/reference keys or tokens. For release, pin an image digest and record application/schema versions. Perform additive migrations before compatible app rollout. On a regression pause new financial dispatch, deploy the previous compatible image and reconcile existing operations. A rollback does not undo a PayPal capture/refund. Never restore an old database and blindly replay new financial writes.

## Backup, restore and retention

Back up each service database plus artifact bytes, current public-key registry and encrypted private-key configuration independently. Keep sensitive backups encrypted and access controlled. Restore into an isolated environment with financial/provider dispatch disabled, rebuild local projections from confirmed journal evidence and reconcile original PayPal resources before enabling writes. Test buyer access and hashes against restored artifacts. RPO/RTO targets from the PRD are unverified until a timed rehearsal; no restore test was performed.

Delivery's maintenance loop expires retained files under the accepted contract. Financial records remain for the merchant's reviewed legal retention period. Customer deletion/financial retention policy, automatic diagnostic evidence expiry and full restore automation are commercial-launch work. Do not infer that deleting a video deletes required transaction records.

## Monitoring and failure recovery

Health is process liveness. Readiness checks the database and reports whether the required integration fields exist, not whether a remote account is valid. Authenticated internal metrics expose tenant-scoped outbox counts. Logs avoid request bodies, tokens and raw provider URLs. Audit stores immutable digests. An external metrics/alert sink is not configured; assign an operator before deployment.

Outboxes use leases, bounded exponential backoff/jitter and dead-letter state. Inspect tenant-scoped metrics and outbox rows through approved operator tooling. A dead letter requires identifying the failed state/identity/contract, correcting the condition and explicitly requeuing the original message. Do not change a financial request key. The worker periodically schedules read-back for pending/unknown payments. An unknown capture with no resource ID can be correlated only if the original order exposes exactly one matching capture and authorization; otherwise NEEDS_REVIEW remains. Unknown refunds lacking a returned resource ID require manual provider-supported correlation; there is no blind retry.

RUNNING investigations older than six minutes become WAITING_FOR_AI for a new reviewed run. Provider submissions without task IDs remain SUBMISSION_UNKNOWN. Explicit cancellation can queue a safe void without AI, but cannot guess whether an unknown capture succeeded. Externally changed authorizations, app/merchant permissions, endpoint-specific idempotency windows and actual webhook delivery must be checked with sandbox receipts.

## Credential rotation and outage

Service-key overlap is supported through `PUBLIC_KEY_REGISTRY`, a JSON map from key ID to `{issuer,pem}`. With that registry configured it is authoritative; the legacy PUBLIC_KEYS map cannot resurrect a retired key. Publish both verification keys, switch `SERVICE_KEY_ID` and the private signing key, wait for the two-minute token lifetime plus clock tolerance, then remove the retired key. The verifier binds key ID to issuer and rejects cross-principal signing. The automated test exercises overlap, retirement and impersonation rejection. Propagate registry changes to every service; external OIDC onboarding is still a launch gate. No credentials rotate implicitly.

Operator POST /v1/controls/payments with paused and a specific reason persists a tenant-scoped dispatch control. It blocks new capture and normal refund dispatch, while explicit safe void/emergency remedies and read-back remain possible. The dispatch-control lock serializes with transition to DISPATCHING; a request already dispatched cannot be recalled. External alert routing remains a release gate. Do not revoke customer access simply because AI is down. Remove a compromised provider key, preserve already obtained output, and reconcile money with the original merchant account. Never put credential values in incident reports.


## Reproducible local quality gate

`npm run verify:local` runs strict typing, the full fixture/API failure suite, a native PostgreSQL integration check, build and OpenAPI export. It never calls an external inference/payment API. Results are in evidence/local-quality.json; detailed logs stay private in .local. Native PostgreSQL uses an isolated random-password cluster bound to loopback and a test port, then stops it. It retains its private test directory instead of deleting user paths. `npm audit --audit-level=high` is a separate dependency check.

The native check exercises pooled command and row-lock concurrency, RLS under a restricted NOINHERIT login, competing refund reservations, rollback, expired outbox claim fencing, encrypted logical restore and restart durability. These are local PostgreSQL results, not managed-service capacity tests. Existing deployment runtime logins should receive `ALTER ROLE runtime NOINHERIT` through a privileged maintenance change; new generated installations already use it.

## Encrypted logical backup and restore

Use `npm run backup -- save payments PRIVATE_PATH.pvd` with private MAINTENANCE_DATABASE_URL and a base64 BACKUP_ENCRYPTION_KEY containing 32 random bytes. Store the key separately from the snapshot. The command takes a repeatable-read logical snapshot and encrypts/authenticates it with AES-256-GCM. It refuses to overwrite an existing file. This database tool has no media-file payload and is not point-in-time recovery.

To rehearse restore, create a separate empty database, apply the same service/schema migrations, set MAINTENANCE_DATABASE_URL to that offline target and run `npm run backup -- restore payments PRIVATE_PATH.pvd`. The target tables are locked, schema/table manifest validated and nonempty targets refused. Relationships and audit sequence are restored transactionally. The automated native check also rejects tampered ciphertext and verifies money, journal, queue and new audit writes. Full media backup, offsite key custody, cross-service recovery consistency and measured disaster RPO/RTO remain launch gates. Never restore over a running financial service or replay old financial writes against new external state.

## AI cost and fallback configuration

See HOSTING_AND_COST.md. Gemini remains primary; Groq/NVIDIA fallbacks are available only with their own keys and confirmed free-tier flags. Set AI_ZERO_COST_ONLY=true. No local model is used. A missing quota/key produces WAITING_FOR_AI, never a rules-only approval. Caller timeouts and outbox leases allow the bounded fallback chain; stale leases are fenced by claim attempt. The process drains an in-flight worker before closing the database on SIGTERM; Compose supplies a 310-second stop grace. An earlier platform force-kill still requires reconciliation.


`node --import tsx scripts/provision-compose.ts --refresh-schema --sync-integrations` explicitly synchronizes external integration values from the private environment while preserving database passwords and service signing keys. --refresh-schema alone continues to preserve all existing values. Neither flag migrates initialized database volumes.

`npm run integration:service-sandbox` is a controlled integration tool using persistent private test databases, actual hosted AI and actual Sandbox money, with explicitly seeded local video/task fixtures. It prepares a private buyer approval handoff and never submits paid generation. Preserve .local/service-sandbox-* after errors. Its --resume mode is limited to a pre-settlement investigation failure, reads the same confirmed authorization and refuses existing financial intents. Other failures require inspecting/reconciling the original operation; do not start another run to evade unknown money. Its reported result is in evidence/service-sandbox-workflow.json. It is not a public fixture bypass in the deployed services.

## Containers (11 November)

One multi-stage `Dockerfile`:

- **`runtime`:** production. No dev dependencies, non-root, liveness `HEALTHCHECK`.
- **`demo`:** the judge walkthrough.

Commands:

- `docker compose -f infra/compose.demo.yaml run --rm demo` runs the full story with no keys and no network.
- For the production topology, run `node --import tsx scripts/provision-compose.ts`, then `docker compose --env-file .local/compose.env -f infra/compose.yaml up --build -d`. This starts five services, five PostgreSQL containers and the verifier. Each service is health-checked on `/ready` (database reachable), and all run under the compose project name `paid-video-delivery`, so they never collide with other local projects.

Logs are JSON on stdout, set by `LOG_LEVEL` (default `info`; `silent` turns them off). Kubernetes is deliberately not used: five small stateless services fit managed containers (Cloud Run or Render) with managed PostgreSQL, and a cluster would add operational load with no P0 benefit.

**Verify a running stack.** Run `COMMERCE_URL=http://127.0.0.1:4100 npm run smoke:containers`. It makes no PayPal order and no generation, and may make one free-tier AI call.

**Troubleshooting.**

- If another local process holds ports 4100–4104, set `COMMERCE_HOST_PORT`, `DELIVERY_HOST_PORT` and `PAYMENTS_HOST_PORT`.
- If Docker reports "all predefined address pools have been fully subnetted", set `PVD_SUBNET` and `PVD_VERIFIER_SUBNET` to unused ranges.
- If `docker version` hangs with no output, the Docker Desktop engine is stuck. Quit Docker Desktop from the tray, start it again and wait for "Engine running". This happened on the development machine on 11 November.
