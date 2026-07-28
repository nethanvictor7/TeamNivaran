# 0016 — Controlled downloads without URL persistence

## Decision

Download grants authorize one available version, record the attempt, and return
a protected Evidence API content path. The Gateway and Evidence Service validate
the bearer token again when streaming. Storage keys, credentials, and signed
URLs are never exposed or persisted.

## Consequences

The portal downloads through an authenticated, `no-store`, attachment response.
Rejected, failed, scanning, and cross-organization versions cannot be streamed.
