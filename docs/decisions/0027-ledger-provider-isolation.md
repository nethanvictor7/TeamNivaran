# ADR 0027: isolate ledger providers behind one stable contract

Status: Accepted

## Context

CDEP requires Fabric now and may add GCUL after its authoritative SDK, signing,
contract, and finality specifications are supplied. Provider concepts must not
become business-domain or public-API concepts.

## Decision

`ledger-service` owns the provider-neutral `LedgerProvider` interface. It accepts
only canonical evidence or decision envelopes and returns normalized states,
opaque references, and versioned allowlisted metadata. Provider selection occurs
only in the provider registry during composition. Fabric Gateway imports, MSP,
channel, chaincode, TLS, signing identity, and Fabric error mapping exist only in
`FabricLedgerProvider`.

Each proof persists its original `providerType` and provider binding. Reads,
status queries, and verification resolve through that binding. `GCUL` fails
closed until a real adapter is installed; mock mode is test-only.

## Consequences

Adding GCUL does not change upstream services, canonical schemas, routes, shared
events, persistence ownership, or portal components. A deployment must retain
adapters needed to verify historical anchors.
