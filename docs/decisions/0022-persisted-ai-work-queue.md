# ADR 0022: Persisted AI work queue and leases

## Status

Accepted

## Decision

Assessment requests persist before returning. A database lease table controls
worker ownership, expiry, retry timing, and recovery. Status changes and
execution attempts are durable.

## Consequences

HTTP request lifetime is decoupled from inference. Restarts do not silently
lose queued work, and operations can inspect attempts and sanitized failures.
