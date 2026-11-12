#!/usr/bin/env bash
# Ship the current working tree to the hosted Sandbox VM and rebuild what changed.
# The frontend is built here first (the 4 GB VM can't build it next to the running
# stack); only its built files are shipped. Private config on the VM is kept.
#   bash infra/gcp/redeploy.sh            (from backend/)
#   SERVICES="web" bash infra/gcp/redeploy.sh
set -euo pipefail
VM="${VM:-assay-sandbox}"
ZONE="${ZONE:-us-central1-a}"
OUT="$(mktemp -d)"
cd "$(dirname "$0")/../../.."
(cd frontend && npx vite build >/dev/null)
tar -czf "$OUT/assay-update.tgz" .dockerignore backend/src backend/scripts backend/migrations \
  backend/infra backend/package.json backend/package-lock.json backend/tsconfig.json \
  backend/tsconfig.build.json backend/Dockerfile backend/sdk/src frontend/dist/client
(cd "$OUT" && gcloud compute scp assay-update.tgz "$VM:/tmp/" --zone "$ZONE" --quiet >/dev/null)
gcloud compute ssh "$VM" --zone "$ZONE" --quiet --command "cd ~/assay && rm -rf frontend/dist/client && tar -xzf /tmp/assay-update.tgz && rm /tmp/assay-update.tgz && cd backend && sudo docker compose --env-file .local/gcp.env -f infra/compose.yaml -f infra/gcp/compose.gcp.yaml up --build -d ${SERVICES:-} > ~/assay-redeploy.log 2>&1; rc=\$?; tail -3 ~/assay-redeploy.log; if [ \$rc != 0 ]; then echo 'BUILD FAILED:'; grep -nE 'error|ERROR' ~/assay-redeploy.log | tail -8; exit \$rc; fi; sudo docker ps --format '{{.Names}} {{.Status}}'"
rm -rf "$OUT"
