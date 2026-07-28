# ADR 0011: Case correlation ownership

Integration Service owns correlation rules and outcomes. Case Service remains
authoritative for external-reference resolution through its guarded API; no
cross-service database queries are permitted.
