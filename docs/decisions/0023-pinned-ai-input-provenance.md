# ADR 0023: Pinned authoritative AI input provenance

## Status

Accepted

## Decision

Every assessment pins Case version, Workflow instance/version, validation run,
prompt version, model policy, runtime configuration, and exact Evidence asset
and version hashes. Input preparation rechecks those owners and verifies
canonical content SHA-256.

## Consequences

Results are reproducible against their recorded inputs. Later authoritative
changes supersede prior successful assessments instead of rewriting history.
