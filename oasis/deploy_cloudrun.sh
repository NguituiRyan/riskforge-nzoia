#!/bin/bash
# Build the Oasis runner on Cloud Build and deploy it to Cloud Run.
#   bash oasis/deploy_cloudrun.sh <gcp-project-id> [region]
# Needs: gcloud signed in, billing enabled on the project.
set -euo pipefail
PROJECT="${1:?usage: deploy_cloudrun.sh <gcp-project-id> [region]}"
REGION="${2:-africa-south1}"
SERVICE=riskforge-oasis
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GCLOUD="${GCLOUD:-gcloud}"

# a small build context: only what the image needs
CTX="$(mktemp -d)"
trap 'rm -rf "$CTX"' EXIT
mkdir -p "$CTX/oasis" "$CTX/web/public/data"
cp "$ROOT/oasis/Dockerfile" "$CTX/"
cp "$ROOT/oasis/riskforge_oasis.py" "$ROOT/oasis/server.py" "$ROOT/oasis/warmup.py" "$CTX/oasis/"
cp "$ROOT/web/public/data/kenya_hazard.json" "$ROOT/web/public/data/buildings_book.geojson" "$CTX/web/public/data/"

"$GCLOUD" services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project "$PROJECT"

IMAGE="$REGION-docker.pkg.dev/$PROJECT/riskforge/$SERVICE:latest"
"$GCLOUD" artifacts repositories describe riskforge --location "$REGION" --project "$PROJECT" >/dev/null 2>&1 ||
  "$GCLOUD" artifacts repositories create riskforge --repository-format docker --location "$REGION" --project "$PROJECT"

# the warm-up compiles the Oasis kernel during the build (a few minutes); the default machine stays in the free tier
"$GCLOUD" builds submit "$CTX" --tag "$IMAGE" --project "$PROJECT" --region "$REGION" --timeout 3600s

"$GCLOUD" run deploy "$SERVICE" --image "$IMAGE" --project "$PROJECT" --region "$REGION" \
  --allow-unauthenticated --execution-environment gen2 --cpu 2 --memory 4Gi --cpu-boost \
  --concurrency 1 --min-instances 0 --max-instances 3 --timeout 600

"$GCLOUD" run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)'
