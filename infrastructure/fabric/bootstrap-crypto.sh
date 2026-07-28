#!/usr/bin/env bash
set -euo pipefail

cd /fabric
if [ ! -f crypto-config/peerOrganizations/cdep.example.com/users/Admin@cdep.example.com/msp/signcerts/Admin@cdep.example.com-cert.pem ]; then
  rm -rf crypto-config/*
  cryptogen generate --config=crypto-config.yaml --output=crypto-config
fi

key="$(find crypto-config/peerOrganizations/cdep.example.com/users/Admin@cdep.example.com/msp/keystore -type f -name '*_sk' -print -quit)"
if [ -z "$key" ]; then
  echo "CDEP Fabric service identity key was not generated." >&2
  exit 1
fi
stable_key=crypto-config/peerOrganizations/cdep.example.com/users/Admin@cdep.example.com/msp/keystore/priv_sk
if [ "$key" != "$stable_key" ]; then
  cp "$key" "$stable_key"
fi
chgrp 10007 "$stable_key"
chmod 0640 "$stable_key"

configtxgen -profile CDEPChannel \
  -channelID cdep-proof-channel \
  -outputBlock channel-artifacts/cdep-proof-channel.block \
  -configPath /fabric
