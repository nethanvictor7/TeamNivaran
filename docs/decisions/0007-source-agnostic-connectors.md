# ADR 0007: Source-agnostic connector boundary

Webhook and PostgreSQL pollers capture immutable source triggers. Webhooks accept
opaque JSON objects or arrays without request/response schemas. Optional
allowlisted field extraction and deterministic reference equality correlation
keep source-specific payload knowledge out of Case Service.
