#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-trustgate-hackathon}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-trustgate}"
FIVETRAN_CONNECTION_ID="${FIVETRAN_CONNECTION_ID:-fulfill_pageant}"
BIGQUERY_PROJECT_ID="${BIGQUERY_PROJECT_ID:-$PROJECT_ID}"
BIGQUERY_DATASET="${BIGQUERY_DATASET:-trustgate_demo}"
BIGQUERY_TABLE="${BIGQUERY_TABLE:-customers}"
VERTEX_PROJECT_ID="${VERTEX_PROJECT_ID:-$PROJECT_ID}"
VERTEX_LOCATION="${VERTEX_LOCATION:-global}"
VERTEX_MODEL="${VERTEX_MODEL:-gemini-3.5-flash}"

gcloud config set project "$PROJECT_ID"

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  bigquery.googleapis.com \
  aiplatform.googleapis.com

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
CLOUD_RUN_SERVICE_ACCOUNT="${CLOUD_RUN_SERVICE_ACCOUNT:-$PROJECT_NUMBER-compute@developer.gserviceaccount.com}"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:$CLOUD_RUN_SERVICE_ACCOUNT" \
  --role roles/bigquery.jobUser \
  --condition=None >/dev/null

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:$CLOUD_RUN_SERVICE_ACCOUNT" \
  --role roles/bigquery.dataViewer \
  --condition=None >/dev/null

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:$CLOUD_RUN_SERVICE_ACCOUNT" \
  --role roles/aiplatform.user \
  --condition=None >/dev/null

if ! gcloud secrets describe fivetran-api-key >/dev/null 2>&1; then
  echo "Create Secret Manager secret: fivetran-api-key"
  read -rsp "Fivetran API key: " FIVETRAN_API_KEY
  echo
  printf "%s" "$FIVETRAN_API_KEY" | gcloud secrets create fivetran-api-key --data-file=-
fi

if ! gcloud secrets describe fivetran-api-secret >/dev/null 2>&1; then
  echo "Create Secret Manager secret: fivetran-api-secret"
  read -rsp "Fivetran API secret: " FIVETRAN_API_SECRET
  echo
  printf "%s" "$FIVETRAN_API_SECRET" | gcloud secrets create fivetran-api-secret --data-file=-
fi

# MIN_INSTANCES keeps one warm instance so the live URL has no cold start during
# recording and the judging period (2026-06-22 to 2026-07-06). Set MIN_INSTANCES=0
# after judging to stop paying for an idle instance.
MIN_INSTANCES="${MIN_INSTANCES:-1}"

gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --min-instances "$MIN_INSTANCES" \
  --set-env-vars "FIVETRAN_CONNECTION_ID=$FIVETRAN_CONNECTION_ID,BIGQUERY_PROJECT_ID=$BIGQUERY_PROJECT_ID,BIGQUERY_DATASET=$BIGQUERY_DATASET,BIGQUERY_TABLE=$BIGQUERY_TABLE,VERTEX_PROJECT_ID=$VERTEX_PROJECT_ID,VERTEX_LOCATION=$VERTEX_LOCATION,VERTEX_MODEL=$VERTEX_MODEL" \
  --set-secrets "FIVETRAN_API_KEY=fivetran-api-key:latest,FIVETRAN_API_SECRET=fivetran-api-secret:latest"

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')"

echo
echo "TrustGate deployed:"
echo "$SERVICE_URL"
echo
echo "Test:"
echo "curl $SERVICE_URL/api/fivetran/evidence"
echo "curl $SERVICE_URL/api/bigquery/evidence"
echo "curl -X POST $SERVICE_URL/api/agent/run -H 'Content-Type: application/json' -d '{\"agent_id\":\"customer_recovery_agent\",\"action_type\":\"approve_refund\",\"customer_id\":\"C-1042\",\"amount\":75,\"reason\":\"late_delivery\"}'"
echo "curl -X POST $SERVICE_URL/api/actions/propose -H 'Content-Type: application/json' -d '{\"agent_id\":\"customer_recovery_agent\",\"action_type\":\"approve_refund\",\"customer_id\":\"C-1042\",\"amount\":75,\"reason\":\"late_delivery\"}'"
