# ADR 0012: Raw event retention and redaction

Accepted source bytes are hashed and represented by an immutable tenant-scoped
source trigger. Normal reads redact payloads; sensitive access requires a dedicated
permission, a reason and an audit record. Dead-letter messages contain references,
never raw payloads.
