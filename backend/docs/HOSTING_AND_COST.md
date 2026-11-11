# Hosting and cost decision

8 November 2026. Local development is authorized. No cloud resource, paid inference, credit purchase or subscription was provisioned by this work.

## Quality and resource limits

The same tenant isolation, media verification, immutable contract, evidence review and payment confirmation gates apply on a small machine and a larger deployment. A free quota exhaustion must pause new work; it must not relax verification or authorize money through a rules-only fallback. A smaller deployment can support fewer jobs and longer queues. It cannot honestly promise the availability, recovery or throughput of infrastructure that has not been tested.

Gemini is primary. Optional Groq and NVIDIA Nemotron are sequential fallbacks with the same bounded read tools, schema checks and literal citation validation. A valid INCONCLUSIVE assessment is preserved rather than retried until a more permissive model agrees. A complete investigation may use up to two requests per provider and three providers, with no more than three distinct provider-tool reads across the chain. The model label and fallback attempts are retained. No local model is used, per the user's instruction.

`AI_ZERO_COST_ONLY` defaults true. A provider key is admitted only when its `GEMINI_FREE_TIER_CONFIRMED`, `GROQ_FREE_TIER_CONFIRMED` or `NVIDIA_FREE_TIER_CONFIRMED` flag is explicitly true. This is an operator assertion after checking the account, not an API-level proof of free billing. Keep paid billing disabled or enforce the provider's actual spending controls. Quota limits and trial credits differ by account and can change. Setting a daily assessment cap alone cannot guarantee a zero invoice. No automatic upgrade, paid-tier selection or credit purchase is implemented.

The existing Runway adapter remains the selected video provider. `ALLOW_PAID_INFERENCE=false` blocks new generation. Original tasks can be read and archived if their API credentials are configured. Fixture MP4 files validate recovery and delivery mechanics, not actual provider generation. A real provider lifecycle needs existing authorized task output or separately approved access; the backend must not manufacture a paid-provider receipt to make the demo look complete.

## Render and Google Cloud

Render supports backend web services, private services, background workers, cron/workflows and managed PostgreSQL, as well as static frontend sites. The earlier assumption that it only hosts frontend is incorrect. Its free web services sleep after 15 minutes, lose local files on restarts/spin-down, cannot attach a persistent disk, and free PostgreSQL expires after 30 days. Render explicitly advises against production use of free instances. See [service types](https://render.com/docs/service-types) and [free limits](https://render.com/docs/free).

Google Cloud Run supports container services, jobs and worker pools. Its request-driven service execution is not sufficient justification to rely on an in-process polling timer when idle CPU is suspended. A Google Cloud deployment needs an explicitly provisioned worker execution strategy, managed PostgreSQL, private object storage, secrets and controlled service ingress. Cloud SQL is billed; trial credits are temporary. See [Cloud Run overview](https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run) and [Cloud SQL pricing](https://cloud.google.com/sql/pricing).

Recommendation: use the local five-service stack for development and evidence collection. The user selected Google Cloud and Gemini for deployment. Keep backend, data, workers and storage together to reduce network, identity and operational complexity. Render is a simpler managed deployment option; Google Cloud offers more deployment controls at greater setup cost. A future frontend may be hosted separately, but there is no need to split clouds because of an imagined Render backend limitation. Neither platform has been deployed or capacity-tested here. The Render Blueprint is a template, not a free or production-ready service inventory.

## PayPal integration depth

The meaningful product lifecycle uses OAuth, Orders creation/read/authorization, authorization read/capture/void, capture read/refund, refund read and webhook signature verification. Each has a job: purchaser consent, reserve a ceiling, charge only verified units, release an unused authorization, correct a postcapture failure, or reconcile external state. $50 authorized and $40 captured leaves $10 unused; that $10 is not a refund.

The [official rules](https://paypalaihackathon.devpost.com/rules) weight five criteria equally and use Technical Implementation as the first tie breaker. They do not award points for the number of APIs. Adding irrelevant Payouts, Subscriptions, Invoicing or Disputes increases failure cases without proving a better product. Webhook registration/event retrieval may be justified for deployment and delayed-event support; Transaction Search may support later finance reconciliation. Neither is an excuse to treat delayed or ambiguous money as confirmed. Finish verified lifecycle receipts, useful AI recovery and an understandable user journey before expanding API breadth.

## Launch boundary

Local passing tests are engineering evidence. They do not certify production readiness. Remaining launch gates include actual provider output, confirmed Sandbox lifecycle and callback delivery, external user identity/onboarding, shared media storage and media backup restore, independent security review, alerts reaching an operator, multi-service recovery, measured load, support ownership and merchant/pilot economics. Frontend remains excluded from the current implementation authorization.


Confirmed local integration evidence now exists: all three hosted AI checks passed after the user confirmed free-tier access; the Sandbox adapter passed actual authorization/capture/refund/void after an approved US test-app configuration. The current Gemini adapter is the Developer API integration. A future Vertex AI/ADC deployment needs its own adapter/authentication verification; it is not implied by choosing Google Cloud. Do not deploy the in-process poller on a scale-to-zero, request-CPU-only service and assume durable background execution. Cloud worker strategy, database/storage provisioning, alert/backup controls and budget review precede cloud launch.
