#!/usr/bin/env bash
# Ship the current working tree (backend source, scripts, migrations, infra; frontend source)
# to the hosted Sandbox VM and rebuild only what changed. Private config on the VM is kept.
#   bash infra/gcp/redeploy.sh            (from backend/)
#   SERVICES="web" bash infra/gcp/redeploy.sh
set -euo pipefail
VM="${VM:-assay-sandbox}"
ZONE="${ZONE:-us-central1-a}"
OUT="$(mktemp -d)"
cd "$(dirname "$0")/../../.."
tar --exclude='*/node_modules' --exclude='*/dist' --exclude='frontend/review' \
  --exclude='frontend/.openai' --exclude='frontend/.taste-skill' --exclude='frontend/.impeccable' \
  -czf "$OUT/assay-update.tgz" .dockerignore backend/src backend/scripts backend/migrations \
  backend/infra backend/package.json backend/package-lock.json backend/tsconfig.json \
  backend/tsconfig.build.json backend/Dockerfile frontend
(cd "$OUT" && gcloud compute scp assay-update.tgz "$VM:/tmp/" --zone "$ZONE" --quiet >/dev/null)
gcloud compute ssh "$VM" --zone "$ZONE" --quiet --command "cd ~/assay && tar -xzf /tmp/assay-update.tgz && rm /tmp/assay-update.tgz && cd backend && sudo docker compose --env-file .local/gcp.env -f infra/compose.yaml -f infra/gcp/compose.gcp.yaml up --build -d ${SERVICES:-} 2>&1 | tail -3 && sudo docker ps --format '{{.Names}} {{.Status}}'"
rm -rf "$OUT"
