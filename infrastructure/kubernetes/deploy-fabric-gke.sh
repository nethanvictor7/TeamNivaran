#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$script_directory/../.." && pwd)"
fabric_directory="$repository_root/infrastructure/fabric"
chaincode_directory="$repository_root/chaincode/evidence-proof"
fabric_namespace="${FABRIC_NAMESPACE:-fabric}"
application_namespace="${CDEP_NAMESPACE:-cdep}"
fabric_timeout="${FABRIC_DEPLOY_TIMEOUT:-20m}"

configuration_files=(
  "$fabric_directory/crypto-config.yaml"
  "$fabric_directory/configtx.yaml"
  "$fabric_directory/bootstrap-crypto.sh"
  "$fabric_directory/deploy-network-ccaas.sh"
  "$chaincode_directory/main.go"
  "$chaincode_directory/go.mod"
  "$chaincode_directory/go.sum"
  "$script_directory/cdep-fabric.yaml"
)

if command -v sha256sum >/dev/null 2>&1; then
  configuration_hash="$(
    sha256sum "${configuration_files[@]}" |
      sha256sum |
      cut -d' ' -f1
  )"
else
  configuration_hash="$(
    shasum -a 256 "${configuration_files[@]}" |
      shasum -a 256 |
      cut -d' ' -f1
  )"
fi

kubectl create namespace "$fabric_namespace" --dry-run=client -o yaml |
  kubectl apply -f -

kubectl -n "$fabric_namespace" create configmap fabric-network-config \
  --from-file=crypto-config.yaml="$fabric_directory/crypto-config.yaml" \
  --from-file=configtx.yaml="$fabric_directory/configtx.yaml" \
  --from-file=bootstrap-crypto.sh="$fabric_directory/bootstrap-crypto.sh" \
  --from-file=deploy-network-ccaas.sh="$fabric_directory/deploy-network-ccaas.sh" \
  --dry-run=client -o yaml |
  kubectl apply -f -

kubectl -n "$fabric_namespace" create configmap fabric-chaincode-source \
  --from-file=main.go="$chaincode_directory/main.go" \
  --from-file=go.mod="$chaincode_directory/go.mod" \
  --from-file=go.sum="$chaincode_directory/go.sum" \
  --dry-run=client -o yaml |
  kubectl apply -f -

kubectl apply -f "$script_directory/cdep-fabric.yaml"
kubectl -n "$fabric_namespace" patch deployment fabric-network \
  --type=merge \
  -p "{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"cdep.io/configuration-hash\":\"$configuration_hash\"}}}}}"

if ! kubectl -n "$fabric_namespace" rollout status \
  deployment/fabric-network --timeout="$fabric_timeout"; then
  echo "Fabric network failed to become available." >&2
  kubectl -n "$fabric_namespace" get pods,services -o wide >&2 || true
  kubectl -n "$fabric_namespace" logs deployment/fabric-network \
    --all-containers --tail=240 >&2 || true
  kubectl -n "$fabric_namespace" describe deployment/fabric-network >&2 || true
  exit 1
fi

fabric_pod="$(
  kubectl -n "$fabric_namespace" get pods \
    -l app.kubernetes.io/name=fabric-network \
    -o jsonpath='{.items[0].metadata.name}'
)"
if [[ -z "$fabric_pod" ]]; then
  echo "Fabric network pod was not found." >&2
  exit 1
fi

temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

kubectl -n "$fabric_namespace" cp \
  "$fabric_pod:/fabric/crypto-config/peerOrganizations/cdep.example.com/peers/peer0.cdep.example.com/tls/ca.crt" \
  "$temporary_directory/tls-ca.crt" \
  -c fabric-admin
kubectl -n "$fabric_namespace" cp \
  "$fabric_pod:/fabric/crypto-config/peerOrganizations/cdep.example.com/users/User1@cdep.example.com/msp/signcerts/User1@cdep.example.com-cert.pem" \
  "$temporary_directory/identity.pem" \
  -c fabric-admin
kubectl -n "$fabric_namespace" cp \
  "$fabric_pod:/fabric/crypto-config/peerOrganizations/cdep.example.com/users/User1@cdep.example.com/msp/keystore" \
  "$temporary_directory/user1-keystore" \
  -c fabric-admin
identity_key="$(
  find "$temporary_directory/user1-keystore" \
    -type f -name '*_sk' -print -quit
)"
if [[ -z "$identity_key" ]]; then
  echo "Fabric User1 enrollment private key was not found." >&2
  exit 1
fi
install -m 0600 "$identity_key" "$temporary_directory/identity-key.pem"

kubectl -n "$application_namespace" create secret generic fabric-client-identity \
  --from-file=tls-ca.crt="$temporary_directory/tls-ca.crt" \
  --from-file=identity.pem="$temporary_directory/identity.pem" \
  --from-file=identity-key.pem="$temporary_directory/identity-key.pem" \
  --dry-run=client -o yaml |
  kubectl apply -f -

if kubectl -n "$application_namespace" get deployment ledger-service \
  >/dev/null 2>&1; then
  kubectl -n "$application_namespace" rollout restart deployment/ledger-service
  kubectl -n "$application_namespace" rollout status \
    deployment/ledger-service --timeout=10m
fi

if kubectl -n "$application_namespace" get deployment api-gateway \
  >/dev/null 2>&1; then
  kubectl -n "$application_namespace" rollout status \
    deployment/api-gateway --timeout=10m
fi

kubectl -n "$fabric_namespace" get pods,services -o wide
kubectl -n "$application_namespace" get \
  deployment/ledger-service deployment/api-gateway
