# ADR 0024: Strict normalized assessment output

## Status

Accepted

## Decision

Provider-shaped output is never exposed directly. A strict versioned schema
normalizes summary, recommendation label, confidence, findings, missing
information, risk indicators, and citations. Citations are membership-checked
against pinned Evidence versions.

## Consequences

Invalid JSON/schema, unknown citations, HTML, hidden-reasoning disclosure, and
duplicate codes fail closed. Raw output is encrypted and operations-only.
