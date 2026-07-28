# ADR 0010: Connector credential protection

Local development encrypts credentials with AES-256-GCM using a runtime-provided
key and unique nonce. APIs expose rotation metadata only. Cloud deployments may
replace local protection with an external secret provider without changing the
connector model.
