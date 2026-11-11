# Deploying the hosted Sandbox

12 November 2026. This is the plan for a public URL that judges and new merchants can open. It runs the same containers that pass the local smoke test, uses your Google Cloud credits for compute and Gemini, and keeps Render for the free public landing page. Nothing here has been deployed yet.

## Short answers

**Do we need Google ADK?** No. ADK (Agent Development Kit) is a framework for building agents. Assay already has its own bounded AI calls, so all it needs is to call Gemini through **Vertex AI** instead of the AI Studio key. That adapter is built: `VertexGemini` in `src/adapters/gemini.ts`. On Google Cloud it signs in as the VM's service account, so there is no AI key to store.

**Which Gemini do the credits pay for?** Google's billing pages, checked on 12 November 2026, say:

- The $300 Google Cloud credit **cannot** pay for the Gemini API in AI Studio, which is what our `GEMINI_API_KEY` uses.
- It **does** pay for Gemini on **Vertex AI**, for trials started before 16 November 2026.
- The AI Studio free tier stays free.

So the careful setup is:

- Keep the free AI Studio key as the primary model. It costs nothing.
- Add Vertex AI as the fallback, which spends credits only when the free tier is unavailable.
- Set `AI_PRIMARY=vertex` only if you want all AI on credits.

**Why not put everything on Render?** Render's free tier has free web services and static sites. But it gives you only one free Postgres per workspace, and that database expires after 30 days. Private services and disks need paid plans. Assay needs five databases, private services and file storage. On Render that is roughly $50+ a month that credits don't cover. `infra/render.yaml` stays as the paid option.

**So:** Google Cloud runs the backend and the web app on credits. Render hosts the public landing page for free, with a "Try the live Sandbox" link to the Google Cloud URL. That keeps Render in the story at no cost and keeps money and data on one host.

## The deployment

```
Internet ──443──> Caddy (TLS) ─┬─ /v1/paypal/webhooks ──> Payments
   one e2-medium VM            ├─ /v1/*  (API keys)   ──> Commerce
   on Google Compute Engine    └─ everything else     ──> Web gateway + built frontend
                                   private compose network: 5 services, 5 PostgreSQL,
                                   isolated media verifier, web-db
   VM service account ──> GCS bucket (archived originals, private)
                      └─> Vertex AI Gemini (credits)
```

Files:

- `infra/gcp/setup.sh` creates the cloud resources.
- `infra/gcp/compose.gcp.yaml` adds the web gateway, its database and Caddy on top of `infra/compose.yaml`.
- `infra/gcp/Caddyfile` routes traffic.
- `infra/gcp/Dockerfile.web` builds the frontend and the gateway.

### Estimated cost from credits

These are list-price estimates, not measured spend.

| Item | Per month |
|---|---|
| e2-medium VM (2 vCPU, 4 GB), always on | about $25 |
| 30 GB boot disk | about $3 |
| Static IP while attached | about $4 |
| GCS bucket, a few GB of clips | under $1 |
| Gemini flash-lite on Vertex (only when used) | cents for demo traffic |
| **Total** | **about $30–35** |

`setup.sh` creates a budget alert at $60 when you pass `BILLING_ACCOUNT`. Google alerts at a budget but does not stop spending there.

## Steps

You do the steps marked **you**. I can do the ones marked **me** once you say go, and only inside the project you name.

1. **You.** Pick or create the Google Cloud project that has the credits. Install the gcloud CLI and run `gcloud auth login`. Tell me the project id, and the billing account id if you want the budget alert.
2. **You or me.** Run the setup script:
   ```bash
   PROJECT=<project-id> BILLING_ACCOUNT=<billing-account> bash infra/gcp/setup.sh
   ```
   It enables Compute, Storage and Vertex AI, then creates:
   - a service account that can only write to the bucket and call Vertex AI
   - a private bucket with a 30-day lifecycle rule
   - a static IP
   - a firewall rule for 80 and 443
   - the VM, with Docker installed

   It prints the domain: `assay-<ip>.sslip.io`, a free name that resolves to the VM, so Caddy can get a certificate without you buying a domain.
3. **Me.**
   1. Run `npm run provision` and then `npx tsx scripts/provision-compose.ts --refresh-schema`. This writes `.local/compose.env`, the database init SQL (including `web.sql` and the currency migration) and the demo members.
   2. Add these values to `.local/compose.env`:
      - `ASSAY_DOMAIN`, `GCS_BUCKET` and `VERTEX_PROJECT`
      - `AI_FALLBACK_PROVIDERS=vertex`
      - `VERTEX_CREDITS_CONFIRMED=true` (only on your say-so, because it spends credits)
      - `SIGNUP_MODE=invite` and `SIGNUP_INVITE_CODE`
   3. Copy the repository and `.local/` to the VM with `gcloud compute scp`. Secrets travel only over that SSH channel and are never committed.
4. **Me.** On the VM:
   ```bash
   cd Assay/backend
   docker compose --env-file .local/compose.env -f infra/compose.yaml -f infra/gcp/compose.gcp.yaml up --build -d
   COMMERCE_URL=https://<domain> npm run smoke:containers
   ```
   Compose paths in the overlay resolve from `infra/`.
5. **You, in the PayPal Developer Dashboard (Sandbox app).**
   1. Add a webhook to `https://<domain>/v1/paypal/webhooks` for these events:
      - `PAYMENT.AUTHORIZATION.CREATED` and `PAYMENT.AUTHORIZATION.VOIDED`
      - `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING` and `PAYMENT.CAPTURE.REFUNDED`
      - `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED` and `CUSTOMER.DISPUTE.RESOLVED`
   2. Send me the Webhook ID. It isn't secret, but it is account configuration.
6. **Me.** Set `PAYPAL_WEBHOOK_ID`, restart Payments, run one Sandbox order through the hosted UI (you click approve as the Sandbox buyer), and record the verified webhook delivery as evidence. This closes the "PayPal webhook received" gap.
7. **You, on Render.** New → Static Site → connect `sankalp2515/Assay`:
   - Root directory: `frontend`
   - Build: `npm ci && npm run build`
   - Publish: `dist/client`

   The landing page and its walkthrough need no backend. Its "Try the live Sandbox" link points at `https://<domain>`. The frontend session owns that link.
8. **You, on Devpost.** Add testing instructions for judges:
   - the URL
   - "Try as merchant" and "Try as buyer" (demo sign-in, Sandbox only)
   - a PayPal Sandbox *personal* test account to approve with. You create it in the Developer Dashboard. Its login is a Sandbox test credential, and you decide whether to publish it.
   - the sign-up invite code if you want judges to create their own merchant

## Safety on the hosted Sandbox

- **PayPal is Sandbox only.** `api-m.sandbox.paypal.com` is hard-coded in the adapter.
- **Demo sign-in.** `WEB_DEMO_LOGIN=true` gives anyone the shared demo merchant and buyer. `/api/session` reports `demo: true`. Never enable it on a deployment that holds real customers.
- **Sign-up.** Use `invite` mode, not `open`, so strangers can't create tenants. It is rate-limited to 5 per hour per IP.
- **Spending.**
  - `ALLOW_PAID_INFERENCE` stays false.
  - Vertex is used only with `VERTEX_CREDITS_CONFIRMED=true`.
  - `MAX_AI_ASSESSMENTS_PER_DAY` caps AI calls.
- **Exposure.** Only 80 and 443 are open. Databases, the verifier and internal routes are reachable only on the compose network, and internal routes still require signed service tokens.
- **Backups.** Postgres runs in containers on the VM disk. Before any change you care about, take a snapshot of the boot disk, or run `npm run backup` and copy the encrypted file to the bucket with `gcloud storage cp`. Cross-service disaster recovery is not tested.

## Teardown

```bash
gcloud compute instances delete assay-sandbox --zone us-central1-a
gcloud compute addresses delete assay-ip --region us-central1
gcloud storage rm -r gs://<project>-assay-artifacts
```

## Other options considered

| Option | Why not first |
|---|---|
| Cloud Run per service plus Cloud SQL | Scales and is managed, but every outbox worker needs always-on CPU: about $50/month per service, and Cloud SQL adds about $10. The credits would run out in weeks |
| Render blueprint (`infra/render.yaml`) | Works, but needs paid private services, Postgres and a disk. Not covered by Google credits |
| Frontend on Render proxying `/api` to Google Cloud | The session cookie and the origin check would span two sites. More moving parts than a link |
