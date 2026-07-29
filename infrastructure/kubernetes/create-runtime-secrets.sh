#!/usr/bin/env bash
set -euo pipefail

namespace="${CDEP_NAMESPACE:-cdep}"
database_host="${CDEP_DATABASE_HOST:-10.128.15.209}"
database_port="${CDEP_DATABASE_PORT:-5432}"
database_user="${CDEP_DATABASE_USER:-cdep_admin}"
database_ssl_mode="${CDEP_DATABASE_SSL_MODE:-require}"

if [[ -z "${CDEP_ALLOYDB_PASSWORD:-}" ]]; then
  echo "CDEP_ALLOYDB_PASSWORD is required." >&2
  exit 1
fi
if [[ -z "${CDEP_BOOTSTRAP_ADMIN_PASSWORD:-}" ]]; then
  echo "CDEP_BOOTSTRAP_ADMIN_PASSWORD is required." >&2
  exit 1
fi

kubectl create namespace "$namespace" --dry-run=client -o yaml |
  kubectl apply -f -

kubectl -n "$namespace" create secret generic alloydb-credentials \
  --from-literal=DATABASE_PASSWORD="$CDEP_ALLOYDB_PASSWORD" \
  --dry-run=client -o yaml |
  kubectl apply -f -

database_url_prefix="postgresql://${database_user}:${CDEP_ALLOYDB_PASSWORD}@${database_host}:${database_port}"
database_url_suffix="?sslmode=${database_ssl_mode}"
kubectl -n "$namespace" create secret generic cdep-database-urls \
  --from-literal=IDENTITY_DATABASE_URL="${database_url_prefix}/${IDENTITY_DB_NAME:-cdep_identity}${database_url_suffix}" \
  --from-literal=CASE_DATABASE_URL="${database_url_prefix}/${CASE_DB_NAME:-cdep_case}${database_url_suffix}" \
  --from-literal=INTEGRATION_DATABASE_URL="${database_url_prefix}/${INTEGRATION_DB_NAME:-cdep_integration}${database_url_suffix}" \
  --from-literal=EVIDENCE_DATABASE_URL="${database_url_prefix}/${EVIDENCE_DB_NAME:-cdep_evidence}${database_url_suffix}" \
  --from-literal=WORKFLOW_DATABASE_URL="${database_url_prefix}/${WORKFLOW_DB_NAME:-cdep_workflow}${database_url_suffix}" \
  --from-literal=AI_DATABASE_URL="${database_url_prefix}/${AI_DB_NAME:-cdep_ai}${database_url_suffix}" \
  --from-literal=LEDGER_DATABASE_URL="${database_url_prefix}/${LEDGER_DB_NAME:-cdep_ledger}${database_url_suffix}" \
  --from-literal=AUDIT_DATABASE_URL="${database_url_prefix}/${AUDIT_DB_NAME:-cdep_audit}${database_url_suffix}" \
  --dry-run=client -o yaml |
  kubectl apply -f -

if ! kubectl -n "$namespace" get secret cdep-audit-secrets >/dev/null 2>&1; then
  audit_cursor_signing_secret="$(openssl rand -hex 32)"
  kubectl -n "$namespace" create secret generic cdep-audit-secrets \
    --from-literal=CURSOR_SIGNING_SECRET="$audit_cursor_signing_secret"
  echo "Created cdep-audit-secrets. Back it up in an approved secret manager."
fi

if kubectl -n "$namespace" get secret cdep-runtime-secrets >/dev/null 2>&1; then
  echo "Secret cdep-runtime-secrets already exists; preserving its signing and encryption keys."
  exit 0
fi

temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 \
  -out "$temporary_directory/jwt-private.pem" >/dev/null 2>&1
openssl pkey -in "$temporary_directory/jwt-private.pem" -pubout \
  -out "$temporary_directory/jwt-public.pem" >/dev/null 2>&1

internal_service_token="$(openssl rand -hex 32)"
connector_encryption_key="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
ai_output_encryption_key="$(openssl rand -base64 48 | tr -d '\n')"
garage_rpc_secret="$(openssl rand -hex 32)"
garage_admin_token="$(openssl rand -hex 32)"
object_storage_access_key="GK$(openssl rand -hex 16)"
object_storage_secret_key="$(openssl rand -hex 32)"
jwt_private_key_base64="$(base64 <"$temporary_directory/jwt-private.pem" | tr -d '\n')"
jwt_public_key_base64="$(base64 <"$temporary_directory/jwt-public.pem" | tr -d '\n')"

kubectl -n "$namespace" create secret generic cdep-runtime-secrets \
  --from-literal=INTERNAL_SERVICE_TOKEN="$internal_service_token" \
  --from-literal=CONNECTOR_CREDENTIAL_ENCRYPTION_KEY="$connector_encryption_key" \
  --from-literal=AI_OUTPUT_ENCRYPTION_KEY="$ai_output_encryption_key" \
  --from-literal=GARAGE_RPC_SECRET="$garage_rpc_secret" \
  --from-literal=GARAGE_ADMIN_TOKEN="$garage_admin_token" \
  --from-literal=OBJECT_STORAGE_ACCESS_KEY="$object_storage_access_key" \
  --from-literal=OBJECT_STORAGE_SECRET_KEY="$object_storage_secret_key" \
  --from-literal=JWT_PRIVATE_KEY_BASE64="$jwt_private_key_base64" \
  --from-literal=JWT_PUBLIC_KEY_BASE64="$jwt_public_key_base64" \
  --from-literal=BOOTSTRAP_ADMIN_PASSWORD="$CDEP_BOOTSTRAP_ADMIN_PASSWORD"

echo "Created cdep-runtime-secrets. Back it up in an approved secret manager."
