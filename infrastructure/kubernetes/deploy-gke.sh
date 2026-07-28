#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
namespace="${CDEP_NAMESPACE:-cdep}"

wait_for_deployment() {
  local deployment_name="$1"
  local timeout="${2:-10m}"

  if kubectl -n "$namespace" rollout status "deployment/$deployment_name" --timeout="$timeout"; then
    return
  fi

  echo "Deployment '$deployment_name' failed to become available." >&2
  kubectl -n "$namespace" get pods \
    -l "app.kubernetes.io/name=$deployment_name" -o wide >&2 || true
  kubectl -n "$namespace" logs "deployment/$deployment_name" \
    --all-containers --tail=200 >&2 || true
  kubectl -n "$namespace" describe "deployment/$deployment_name" >&2 || true
  exit 1
}

wait_for_job() {
  local job_name="$1"
  local timeout="${2:-10m}"

  if kubectl -n "$namespace" wait \
    --for=condition=complete "job/$job_name" --timeout="$timeout"; then
    return
  fi

  echo "Job '$job_name' failed to complete." >&2
  kubectl -n "$namespace" get pods \
    -l "job-name=$job_name" -o wide >&2 || true
  kubectl -n "$namespace" logs "job/$job_name" \
    --all-containers --tail=200 >&2 || true
  kubectl -n "$namespace" describe "job/$job_name" >&2 || true
  exit 1
}

for secret_name in gitlab-registry alloydb-credentials cdep-database-urls cdep-runtime-secrets; do
  if ! kubectl -n "$namespace" get secret "$secret_name" >/dev/null 2>&1; then
    echo "Required Secret '$secret_name' is missing in namespace '$namespace'." >&2
    exit 1
  fi
done

kubectl apply -f "$script_directory/alloydb-config.yaml"
kubectl apply -f "$script_directory/cdep-runtime-config.yaml"
kubectl apply -f "$script_directory/cdep-edge.yaml"
kubectl apply -f "$script_directory/cdep-gateway.yaml"
kubectl -n "$namespace" delete ingress/cdep ingress/cdep-objects --ignore-not-found

kubectl -n "$namespace" delete job/kafka-topic-bootstrap --ignore-not-found
kubectl apply -f "$script_directory/cdep-infrastructure.yaml"

# Redis is no longer part of CDEP. kubectl apply does not prune objects that
# were removed from a manifest, so clean up any legacy workload and Service.
# The PVC is deliberately retained for an explicit, separately approved cleanup.
kubectl -n "$namespace" delete deployment/redis service/redis --ignore-not-found

for deployment_name in kafka garage clamav; do
  wait_for_deployment "$deployment_name" 15m
done
wait_for_job kafka-topic-bootstrap 10m

migration_jobs=(
  identity-migrate
  case-migrate
  integration-migrate
  evidence-migrate
  workflow-migrate
  ai-migrate
  ledger-migrate
)
kubectl -n "$namespace" delete job "${migration_jobs[@]}" --ignore-not-found
kubectl apply -f "$script_directory/cdep-migrations.yaml"
for job_name in "${migration_jobs[@]}"; do
  wait_for_job "$job_name" 10m
done

kubectl -n "$namespace" delete \
  job/identity-seed job/evidence-storage-bootstrap --ignore-not-found
kubectl apply -f "$script_directory/cdep-bootstrap.yaml"
wait_for_job identity-seed 10m
wait_for_job evidence-storage-bootstrap 10m

kubectl apply -f "$script_directory/cdep-backends.yaml"
for deployment_name in identity-access-service case-service integration-ingestion-service evidence-service validation-workflow-service ai-assessment-service; do
  wait_for_deployment "$deployment_name" 10m
done

bash "$script_directory/deploy-fabric-gke.sh"
wait_for_deployment ledger-service 10m
wait_for_deployment api-gateway 10m
kubectl -n "$namespace" get pods,services,gateway,httproute
