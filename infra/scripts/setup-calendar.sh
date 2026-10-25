#!/usr/bin/env bash
# Connects interview scheduling to Google Calendar + Meet on the live service.
#
# Run from a machine with gcloud signed in as a project owner:
#   bash infra/scripts/setup-calendar.sh
#
# It is safe to re-run: existing pieces are left as they are, and each run adds a new secret
# version only if you choose to create a new key.
#
# One step can't be scripted: a Google Workspace super-admin must authorise the service account
# for domain-wide delegation (printed at the end). Until then, booking fails with
# "unauthorized_client" and the app keeps working without calendar events.
set -euo pipefail

PROJECT="${PROJECT:-project-0fbee011-38fa-4913-a64}"
REGION="${REGION:-asia-south1}"
SERVICE="${SERVICE:-iclabs-workspace}"
SA_NAME="workspace-calendar"
SECRET="workspace-calendar-sa-key"
# Must be a real Google Workspace user with Calendar (not a Cloudflare forwarding address):
# every interview event is created on its calendar and the delegation impersonates it.
ORGANIZER="${ORGANIZER:-hiring@isocodelabs.com}"
SCOPE="https://www.googleapis.com/auth/calendar"

SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
gcloud config set project "$PROJECT" >/dev/null

echo "1/5 Enabling the Calendar API"
gcloud services enable calendar-json.googleapis.com secretmanager.googleapis.com

echo "2/5 Service account ${SA_EMAIL}"
gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1 ||
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="Workspace interview scheduling (Calendar DWD)"

echo "3/5 Key in Secret Manager (${SECRET})"
if gcloud secrets describe "$SECRET" >/dev/null 2>&1 &&
  [[ "${NEW_KEY:-}" != "1" ]]; then
  echo "    Secret exists; keeping it. Re-run with NEW_KEY=1 to rotate."
else
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  gcloud iam service-accounts keys create "$tmp/key.json" --iam-account="$SA_EMAIL"
  # The app wants the PEM private key only (CALENDAR_SA_KEY), not the whole JSON file.
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["private_key"], end="")' \
    "$tmp/key.json" >"$tmp/key.pem"
  gcloud secrets describe "$SECRET" >/dev/null 2>&1 ||
    gcloud secrets create "$SECRET" --replication-policy=automatic
  gcloud secrets versions add "$SECRET" --data-file="$tmp/key.pem"
fi

echo "4/5 Letting the Cloud Run service read the key"
RUNTIME_SA="$(gcloud run services describe "$SERVICE" --region="$REGION" \
  --format='value(spec.template.spec.serviceAccountName)')"
RUNTIME_SA="${RUNTIME_SA:-$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')-compute@developer.gserviceaccount.com}"
gcloud secrets add-iam-policy-binding "$SECRET" \
  --member="serviceAccount:${RUNTIME_SA}" --role=roles/secretmanager.secretAccessor >/dev/null

echo "5/5 Switching the service to Google Calendar"
# update-* keeps every other variable and secret; Cloud Build deploys keep these settings.
gcloud run services update "$SERVICE" --region="$REGION" \
  --update-env-vars="CALENDAR_DRIVER=google,CALENDAR_ORGANIZER=${ORGANIZER},CALENDAR_SA_EMAIL=${SA_EMAIL}" \
  --update-secrets="CALENDAR_SA_KEY=${SECRET}:latest"

CLIENT_ID="$(gcloud iam service-accounts describe "$SA_EMAIL" --format='value(oauth2ClientId)')"
cat <<EOF

Done on the Cloud side. Last step, by a Google Workspace super-admin:
  admin.google.com → Security → Access and data control → API controls →
  Manage domain-wide delegation → Add new
    Client ID:    ${CLIENT_ID}
    OAuth scopes: ${SCOPE}

Then check: schedule a test interview at https://workspace.isocodelabs.com/team/interviews.
It should show a Meet link, flag busy panelists, and reschedule/cancel the same event.
EOF
