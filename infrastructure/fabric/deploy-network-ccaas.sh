#!/usr/bin/env bash
set -euo pipefail

fabric_root="${FABRIC_ROOT:-/fabric}"
channel_name="${FABRIC_CHANNEL_NAME:-cdep-proof-channel}"
chaincode_name="${FABRIC_CHAINCODE_NAME:-cdep-proof-registry}"
chaincode_label="${FABRIC_CHAINCODE_LABEL:-cdep-proof-registry_1}"
chaincode_version="${FABRIC_CHAINCODE_VERSION:-1.0}"
chaincode_sequence="${FABRIC_CHAINCODE_SEQUENCE:-1}"
chaincode_address="${FABRIC_CHAINCODE_ADDRESS:-127.0.0.1:9999}"

orderer_ca="$fabric_root/crypto-config/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem"
orderer_tls="$fabric_root/crypto-config/ordererOrganizations/example.com/orderers/orderer.example.com/tls"
cdep_msp="$fabric_root/crypto-config/peerOrganizations/cdep.example.com/users/Admin@cdep.example.com/msp"
cdep_tls="$fabric_root/crypto-config/peerOrganizations/cdep.example.com/peers/peer0.cdep.example.com/tls/ca.crt"
audit_msp="$fabric_root/crypto-config/peerOrganizations/audit.example.com/users/Admin@audit.example.com/msp"
audit_tls="$fabric_root/crypto-config/peerOrganizations/audit.example.com/peers/peer0.audit.example.com/tls/ca.crt"
artifacts_directory="$fabric_root/channel-artifacts"
package_path="$artifacts_directory/cdep-proof-registry-ccaas.tar.gz"
package_id_path="$artifacts_directory/package-id"
ready_path="$artifacts_directory/deployment-ready"

export CORE_PEER_TLS_ENABLED=true

use_cdep_peer() {
  export CORE_PEER_LOCALMSPID=CDEPMSP
  export CORE_PEER_MSPCONFIGPATH="$cdep_msp"
  export CORE_PEER_TLS_ROOTCERT_FILE="$cdep_tls"
  export CORE_PEER_ADDRESS=peer0.cdep.example.com:7051
}

use_audit_peer() {
  export CORE_PEER_LOCALMSPID=AuditMSP
  export CORE_PEER_MSPCONFIGPATH="$audit_msp"
  export CORE_PEER_TLS_ROOTCERT_FILE="$audit_tls"
  export CORE_PEER_ADDRESS=peer0.audit.example.com:8051
}

wait_for_peer() {
  local description="$1"
  for attempt in $(seq 1 90); do
    if peer node status >/dev/null 2>&1; then
      return
    fi
    if [[ "$attempt" == 90 ]]; then
      echo "$description did not become available." >&2
      exit 1
    fi
    sleep 2
  done
}

wait_for_orderer() {
  for attempt in $(seq 1 90); do
    if osnadmin channel list \
      -o orderer.example.com:9443 \
      --ca-file "$orderer_ca" \
      --client-cert "$orderer_tls/server.crt" \
      --client-key "$orderer_tls/server.key" >/dev/null 2>&1; then
      return
    fi
    if [[ "$attempt" == 90 ]]; then
      echo "Fabric orderer admin endpoint did not become available." >&2
      exit 1
    fi
    sleep 2
  done
}

create_ccaas_package() {
  local temporary_directory
  temporary_directory="$(mktemp -d)"
  mkdir -p "$temporary_directory/code"

  printf '%s\n' \
    "{\"address\":\"$chaincode_address\",\"dial_timeout\":\"10s\",\"tls_required\":false}" \
    >"$temporary_directory/code/connection.json"
  printf '%s\n' \
    "{\"path\":\"\",\"type\":\"ccaas\",\"label\":\"$chaincode_label\"}" \
    >"$temporary_directory/metadata.json"

  tar --sort=name --mtime="@0" --owner=0 --group=0 --numeric-owner \
    -C "$temporary_directory/code" -cf "$temporary_directory/code.tar" connection.json
  gzip -n "$temporary_directory/code.tar"
  tar --sort=name --mtime="@0" --owner=0 --group=0 --numeric-owner \
    -C "$temporary_directory" -cf "$temporary_directory/package.tar" \
    metadata.json code.tar.gz
  gzip -n "$temporary_directory/package.tar"
  install -m 0644 "$temporary_directory/package.tar.gz" "$package_path"

  local package_id
  package_id="$(peer lifecycle chaincode calculatepackageid "$package_path")"
  printf '%s\n' "$package_id" >"$package_id_path.tmp"
  mv "$package_id_path.tmp" "$package_id_path"
  rm -rf "$temporary_directory"
}

install_for_current_peer() {
  local package_id
  package_id="$(cat "$package_id_path")"
  if ! peer lifecycle chaincode queryinstalled 2>/dev/null | grep -Fq "$package_id"; then
    peer lifecycle chaincode install "$package_path"
  fi
}

rm -f "$ready_path"
mkdir -p "$artifacts_directory"

use_cdep_peer
wait_for_peer "CDEP peer"
use_audit_peer
wait_for_peer "Audit peer"
wait_for_orderer

if ! osnadmin channel list \
  -o orderer.example.com:9443 \
  --ca-file "$orderer_ca" \
  --client-cert "$orderer_tls/server.crt" \
  --client-key "$orderer_tls/server.key" | grep -Fq "$channel_name"; then
  osnadmin channel join \
    --channelID "$channel_name" \
    --config-block "$artifacts_directory/$channel_name.block" \
    -o orderer.example.com:9443 \
    --ca-file "$orderer_ca" \
    --client-cert "$orderer_tls/server.crt" \
    --client-key "$orderer_tls/server.key"
fi

use_cdep_peer
if ! peer channel list | grep -Fq "$channel_name"; then
  peer channel join -b "$artifacts_directory/$channel_name.block"
fi

use_audit_peer
if ! peer channel list | grep -Fq "$channel_name"; then
  peer channel join -b "$artifacts_directory/$channel_name.block"
fi

use_cdep_peer
create_ccaas_package
install_for_current_peer

use_audit_peer
install_for_current_peer

policy="AND('CDEPMSP.peer','AuditMSP.peer')"
if ! peer lifecycle chaincode querycommitted \
  -C "$channel_name" -n "$chaincode_name" >/dev/null 2>&1; then
  use_cdep_peer
  peer lifecycle chaincode approveformyorg \
    -o orderer.example.com:7050 --tls --cafile "$orderer_ca" \
    -C "$channel_name" -n "$chaincode_name" -v "$chaincode_version" \
    --package-id "$(cat "$package_id_path")" \
    --sequence "$chaincode_sequence" --signature-policy "$policy"

  use_audit_peer
  peer lifecycle chaincode approveformyorg \
    -o orderer.example.com:7050 --tls --cafile "$orderer_ca" \
    -C "$channel_name" -n "$chaincode_name" -v "$chaincode_version" \
    --package-id "$(cat "$package_id_path")" \
    --sequence "$chaincode_sequence" --signature-policy "$policy"

  use_cdep_peer
  peer lifecycle chaincode commit \
    -o orderer.example.com:7050 --tls --cafile "$orderer_ca" \
    -C "$channel_name" -n "$chaincode_name" -v "$chaincode_version" \
    --sequence "$chaincode_sequence" --signature-policy "$policy" \
    --peerAddresses peer0.cdep.example.com:7051 \
    --tlsRootCertFiles "$cdep_tls" \
    --peerAddresses peer0.audit.example.com:8051 \
    --tlsRootCertFiles "$audit_tls"
fi

use_cdep_peer
for attempt in $(seq 1 90); do
  if peer chaincode query \
    -C "$channel_name" \
    -n "$chaincode_name" \
    -c '{"Args":["GetNetworkStatus"]}' >/dev/null 2>&1; then
    touch "$ready_path"
    peer lifecycle chaincode querycommitted \
      -C "$channel_name" -n "$chaincode_name"
    echo "Fabric channel and CCAAS proof registry are ready."
    exit 0
  fi
  if [[ "$attempt" == 90 ]]; then
    echo "Committed proof chaincode did not become callable." >&2
    exit 1
  fi
  sleep 2
done
