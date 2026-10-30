#!/usr/bin/env bash
# One-time setup for test.workspace.isocodelabs.com (the "test" branch).
# Already done: database iclabs_workspace_test, bucket ...-workspace-uploads-test,
# serverless NEG workspace-test-neg, backend service workspace-test-backend,
# Cloud Build trigger deploy-test-branch.
# This script does the rest. Safe to re-run: steps that already exist are skipped.
set -euo pipefail

P=project-0fbee011-38fa-4913-a64
REGION=asia-south1
SA=724401189538-compute@developer.gserviceaccount.com
HOST=test.workspace.isocodelabs.com
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "1. Database URL secret for the test database (value is never printed)"
if ! gcloud secrets describe workspace-database-url-test --project $P >/dev/null 2>&1; then
  gcloud secrets versions access latest --secret workspace-database-url-mum --project $P |
    sed -E 's#/iclabs_workspace([?]|$)#/iclabs_workspace_test\1#' >"$TMP/dburl"
  grep -q iclabs_workspace_test "$TMP/dburl" || { echo "could not rewrite the database name"; exit 1; }
  gcloud secrets create workspace-database-url-test --project $P \
    --replication-policy automatic --data-file="$TMP/dburl"
fi
gcloud secrets add-iam-policy-binding workspace-database-url-test --project $P \
  --member serviceAccount:$SA --role roles/secretmanager.secretAccessor --format=none

echo "2. Cloud Run service iclabs-workspace-test (copy of production, pointed at test resources)"
gcloud run services describe iclabs-workspace --project $P --region $REGION --format=export |
  sed -E \
    -e '/run.googleapis.com\/urls:/d' \
    -e '/client.knative.dev\/nonce/d' \
    -e 's/^  name: iclabs-workspace$/  name: iclabs-workspace-test/' \
    -e "s/(maxScale): '[0-9]+'/\1: '2'/" \
    -e "s/(minScale): '[0-9]+'/\1: '0'/" \
    -e "s#value: https://workspace.isocodelabs.com#value: https://$HOST#" \
    -e 's/name: workspace-database-url-mum/name: workspace-database-url-test/' \
    -e 's/workspace-uploads-prod/workspace-uploads-test/' >"$TMP/svc.yaml"
grep -q "name: iclabs-workspace-test" "$TMP/svc.yaml"
gcloud run services replace "$TMP/svc.yaml" --project $P --region $REGION

echo "3. Run migrations on the test database"
gcloud run jobs describe workspace-migrate --project $P --region $REGION --format=export |
  sed -E -e 's/^  name: workspace-migrate$/  name: workspace-migrate-test/' \
    -e 's/name: workspace-database-url-mum/name: workspace-database-url-test/' \
    -e '/run.googleapis.com\/lastModifier/d' >"$TMP/job.yaml"
gcloud run jobs replace "$TMP/job.yaml" --project $P --region $REGION
gcloud run jobs execute workspace-migrate-test --project $P --region $REGION --wait

echo "4. Load balancer: send $HOST to the test service"
gcloud compute backend-services add-backend workspace-test-backend --global --project $P \
  --network-endpoint-group workspace-test-neg --network-endpoint-group-region $REGION || true
gcloud compute url-maps add-path-matcher workspace-urlmap --global --project $P \
  --path-matcher-name test-site --default-service workspace-test-backend --new-hosts $HOST || true

echo "5. HTTPS certificate for $HOST"
gcloud certificate-manager dns-authorizations create workspace-test-dns-auth \
  --domain $HOST --project $P || true
gcloud certificate-manager certificates create workspace-test-cert --project $P \
  --domains $HOST --dns-authorizations workspace-test-dns-auth || true
gcloud certificate-manager maps entries create workspace-test-entry --project $P \
  --map workspace-cert-map --hostname $HOST --certificates workspace-test-cert || true

echo "6. Cron jobs for the test site (email outbox and stage sweep)"
URI=$(gcloud run services describe iclabs-workspace-test --project $P --region $REGION --format='value(status.url)')
CRON=$(gcloud secrets versions access latest --secret workspace-cron-secret --project $P)
for job in "email-outbox:/api/cron/email-outbox" "stages-sweep:/api/cron/stages"; do
  name=workspace-test-${job%%:*}
  gcloud scheduler jobs describe $name --location $REGION --project $P >/dev/null 2>&1 ||
    gcloud scheduler jobs create http $name --location $REGION --project $P \
      --schedule "* * * * *" --time-zone Etc/UTC --http-method POST \
      --uri "$URI${job#*:}" --headers "Authorization=Bearer $CRON" --attempt-deadline 120s
done

echo
echo "Done. Add these two records in Cloudflare (DNS only, grey cloud):"
gcloud certificate-manager dns-authorizations describe workspace-test-dns-auth --project $P \
  --format='value(dnsResourceRecord.type,dnsResourceRecord.name,dnsResourceRecord.data)'
echo "A      $HOST.  $(gcloud compute forwarding-rules describe workspace-https-rule --global --project $P --format='value(IPAddress)')"
