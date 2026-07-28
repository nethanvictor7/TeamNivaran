#!/usr/bin/env bash
set -euo pipefail

CHANNEL_NAME="${FABRIC_CHANNEL_NAME:-cdep-proof-channel}"
CHAINCODE_NAME="${FABRIC_CHAINCODE_NAME:-cdep-proof-registry}"
ORDERER_CA=/fabric/crypto-config/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem
ORDERER_TLS=/fabric/crypto-config/ordererOrganizations/example.com/orderers/orderer.example.com/tls
CDEP_MSP=/fabric/crypto-config/peerOrganizations/cdep.example.com/users/Admin@cdep.example.com/msp
CDEP_TLS=/fabric/crypto-config/peerOrganizations/cdep.example.com/peers/peer0.cdep.example.com/tls/ca.crt
AUDIT_MSP=/fabric/crypto-config/peerOrganizations/audit.example.com/users/Admin@audit.example.com/msp
AUDIT_TLS=/fabric/crypto-config/peerOrganizations/audit.example.com/peers/peer0.audit.example.com/tls/ca.crt

export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=CDEPMSP
export CORE_PEER_MSPCONFIGPATH="$CDEP_MSP"
export CORE_PEER_TLS_ROOTCERT_FILE="$CDEP_TLS"
export CORE_PEER_ADDRESS=peer0.cdep.example.com:7051

for attempt in $(seq 1 60); do
  if peer node status >/dev/null 2>&1; then break; fi
  if [ "$attempt" = 60 ]; then echo "CDEP peer did not start." >&2; exit 1; fi
  sleep 2
done

for attempt in $(seq 1 60); do
  if osnadmin channel list \
    -o orderer.example.com:9443 \
    --ca-file "$ORDERER_CA" \
    --client-cert "$ORDERER_TLS/server.crt" \
    --client-key "$ORDERER_TLS/server.key" >/dev/null 2>&1; then break; fi
  if [ "$attempt" = 60 ]; then echo "Raft orderer admin endpoint did not start." >&2; exit 1; fi
  sleep 2
done

if ! osnadmin channel list \
  -o orderer.example.com:9443 \
  --ca-file "$ORDERER_CA" \
  --client-cert "$ORDERER_TLS/server.crt" \
  --client-key "$ORDERER_TLS/server.key" | grep -q "$CHANNEL_NAME"; then
  osnadmin channel join \
    --channelID "$CHANNEL_NAME" \
    --config-block "/fabric/channel-artifacts/${CHANNEL_NAME}.block" \
    -o orderer.example.com:9443 \
    --ca-file "$ORDERER_CA" \
    --client-cert "$ORDERER_TLS/server.crt" \
    --client-key "$ORDERER_TLS/server.key"
fi

if ! peer channel list | grep -q "$CHANNEL_NAME"; then
  peer channel join -b "/fabric/channel-artifacts/${CHANNEL_NAME}.block"
fi

export CORE_PEER_LOCALMSPID=AuditMSP
export CORE_PEER_MSPCONFIGPATH="$AUDIT_MSP"
export CORE_PEER_TLS_ROOTCERT_FILE="$AUDIT_TLS"
export CORE_PEER_ADDRESS=peer0.audit.example.com:8051
for attempt in $(seq 1 60); do
  if peer node status >/dev/null 2>&1; then break; fi
  if [ "$attempt" = 60 ]; then echo "Audit peer did not start." >&2; exit 1; fi
  sleep 2
done
if ! peer channel list | grep -q "$CHANNEL_NAME"; then
  peer channel join -b "/fabric/channel-artifacts/${CHANNEL_NAME}.block"
fi

if peer lifecycle chaincode querycommitted -C "$CHANNEL_NAME" -n "$CHAINCODE_NAME" >/dev/null 2>&1; then
  echo "Fabric channel and chaincode are already deployed."
  exit 0
fi

rm -f /fabric/channel-artifacts/cdep-proof-registry.tar.gz
export CORE_PEER_LOCALMSPID=CDEPMSP
export CORE_PEER_MSPCONFIGPATH="$CDEP_MSP"
export CORE_PEER_TLS_ROOTCERT_FILE="$CDEP_TLS"
export CORE_PEER_ADDRESS=peer0.cdep.example.com:7051
peer lifecycle chaincode package /fabric/channel-artifacts/cdep-proof-registry.tar.gz \
  --path /fabric/chaincode/evidence-proof \
  --lang golang \
  --label cdep-proof-registry_1
peer lifecycle chaincode install /fabric/channel-artifacts/cdep-proof-registry.tar.gz
PACKAGE_ID="$(peer lifecycle chaincode calculatepackageid /fabric/channel-artifacts/cdep-proof-registry.tar.gz)"

export CORE_PEER_LOCALMSPID=AuditMSP
export CORE_PEER_MSPCONFIGPATH="$AUDIT_MSP"
export CORE_PEER_TLS_ROOTCERT_FILE="$AUDIT_TLS"
export CORE_PEER_ADDRESS=peer0.audit.example.com:8051
peer lifecycle chaincode install /fabric/channel-artifacts/cdep-proof-registry.tar.gz

POLICY="AND('CDEPMSP.peer','AuditMSP.peer')"
export CORE_PEER_LOCALMSPID=CDEPMSP
export CORE_PEER_MSPCONFIGPATH="$CDEP_MSP"
export CORE_PEER_TLS_ROOTCERT_FILE="$CDEP_TLS"
export CORE_PEER_ADDRESS=peer0.cdep.example.com:7051
peer lifecycle chaincode approveformyorg \
  -o orderer.example.com:7050 --tls --cafile "$ORDERER_CA" \
  -C "$CHANNEL_NAME" -n "$CHAINCODE_NAME" -v 1.0 --package-id "$PACKAGE_ID" \
  --sequence 1 --signature-policy "$POLICY"

export CORE_PEER_LOCALMSPID=AuditMSP
export CORE_PEER_MSPCONFIGPATH="$AUDIT_MSP"
export CORE_PEER_TLS_ROOTCERT_FILE="$AUDIT_TLS"
export CORE_PEER_ADDRESS=peer0.audit.example.com:8051
peer lifecycle chaincode approveformyorg \
  -o orderer.example.com:7050 --tls --cafile "$ORDERER_CA" \
  -C "$CHANNEL_NAME" -n "$CHAINCODE_NAME" -v 1.0 --package-id "$PACKAGE_ID" \
  --sequence 1 --signature-policy "$POLICY"

export CORE_PEER_LOCALMSPID=CDEPMSP
export CORE_PEER_MSPCONFIGPATH="$CDEP_MSP"
export CORE_PEER_TLS_ROOTCERT_FILE="$CDEP_TLS"
export CORE_PEER_ADDRESS=peer0.cdep.example.com:7051
peer lifecycle chaincode commit \
  -o orderer.example.com:7050 --tls --cafile "$ORDERER_CA" \
  -C "$CHANNEL_NAME" -n "$CHAINCODE_NAME" -v 1.0 --sequence 1 \
  --signature-policy "$POLICY" \
  --peerAddresses peer0.cdep.example.com:7051 --tlsRootCertFiles "$CDEP_TLS" \
  --peerAddresses peer0.audit.example.com:8051 --tlsRootCertFiles "$AUDIT_TLS"

peer lifecycle chaincode querycommitted -C "$CHANNEL_NAME" -n "$CHAINCODE_NAME"
