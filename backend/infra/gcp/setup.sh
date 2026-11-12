#!/usr/bin/env bash
# Creates the hosted Sandbox deployment on Google Cloud. Run it yourself, from a machine
# where `gcloud auth login` is done, after reading backend/docs/DEPLOY.md. Every resource
# it creates is billed to PROJECT (credits first). It changes nothing outside PROJECT.
#
#   PROJECT=my-assay-project BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX bash infra/gcp/setup.sh
set -euo pipefail
: "${PROJECT:?Set PROJECT to your Google Cloud project id}"
REGION="${REGION:-us-central1}"
ZONE="${ZONE:-us-central1-a}"
VM="${VM:-assay-sandbox}"
MACHINE="${MACHINE:-e2-medium}"   # 2 vCPU, 4 GB: about $25/month of credits
BUCKET="${BUCKET:-${PROJECT}-assay-artifacts}"
SA_NAME="assay-vm"
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

gcloud config set project "$PROJECT"
gcloud services enable compute.googleapis.com storage.googleapis.com aiplatform.googleapis.com

# Spend guard: an alert at 50%, 90% and 100% of a small monthly budget. Alerts only;
# Google does not stop spending at a budget, so watch the email.
if [[ -n "${BILLING_ACCOUNT:-}" ]]; then
  gcloud services enable billingbudgets.googleapis.com
  # Budgets use the billing account's own currency and the project number.
  CUR=$(gcloud billing accounts describe "$BILLING_ACCOUNT" --format="value(currencyCode)")
  PN=$(gcloud projects describe "$PROJECT" --format="value(projectNumber)")
  AMOUNT="${BUDGET_AMOUNT:-$([ "$CUR" = "INR" ] && echo 5000 || echo 60)}"
  gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" \
    --display-name="assay-sandbox" --budget-amount="${AMOUNT}${CUR}" \
    --filter-projects="projects/$PN" \
    --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 || true
fi

# A service account with only what the VM needs: write archived clips to one bucket and
# call Gemini on Vertex AI. No key file is created; the VM gets tokens from metadata.
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 ||
  gcloud iam service-accounts create "$SA_NAME" --display-name="Assay sandbox VM"
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" \
  --role="roles/aiplatform.user" --condition=None >/dev/null

# Private bucket: no public access, uniform permissions, originals deleted after 30 days
# as a backstop (the app expires them after 7).
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 ||
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" \
    --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update "gs://$BUCKET" --lifecycle-file="$(dirname "$0")/lifecycle.json"
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$SA" --role="roles/storage.objectAdmin" >/dev/null

# Static IP, firewall for 80/443 only, and the VM with Docker.
gcloud compute addresses describe assay-ip --region="$REGION" >/dev/null 2>&1 ||
  gcloud compute addresses create assay-ip --region="$REGION"
IP=$(gcloud compute addresses describe assay-ip --region="$REGION" --format='value(address)')
gcloud compute firewall-rules describe assay-web >/dev/null 2>&1 ||
  gcloud compute firewall-rules create assay-web --allow=tcp:80,tcp:443 --target-tags=assay-web
gcloud compute instances describe "$VM" --zone="$ZONE" >/dev/null 2>&1 ||
  gcloud compute instances create "$VM" --zone="$ZONE" --machine-type="$MACHINE" \
    --image-family=debian-12 --image-project=debian-cloud --boot-disk-size=30GB \
    --address="$IP" --tags=assay-web --service-account="$SA" \
    --scopes=cloud-platform --shielded-secure-boot \
    --metadata=enable-oslogin=TRUE --metadata-from-file=startup-script="$(dirname "$0")/startup.sh"

DOMAIN="assay-${IP//./-}.sslip.io"
cat <<EOF

Created. Next steps (backend/docs/DEPLOY.md, step 4 onward):
  VM:      $VM ($MACHINE, $ZONE), IP $IP
  Domain:  https://$DOMAIN   (sslip.io resolves to the IP; Caddy gets the certificate)
  Bucket:  gs://$BUCKET
  Set in .local/compose.env on the VM:
    ASSAY_DOMAIN=$DOMAIN
    GCS_BUCKET=$BUCKET
    VERTEX_PROJECT=$PROJECT
EOF
