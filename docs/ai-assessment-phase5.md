# Phase 5 AI Assessment and Decision Support

Phase 5 adds an independently deployed `ai-assessment-service` and isolated
`cdep_ai` database. It provides asynchronous, governed assessment support over
the authoritative Phase 4 Case, Workflow, and Evidence records.

## Verified adapter boundary

`CortexGateway` is the stable internal interface. This phase implements only
`MockCortexGateway`. `AI_ADAPTER_MODE=MOCK` is deterministic and performs no
provider network calls. Enabled mock assessment processing is rejected when
`NODE_ENV=production`. `AI_ADAPTER_MODE=CORTEX` is also rejected because the
real Cortex API contract has deliberately not been guessed.

The supported mock profiles are `SUCCESS`, `MISSING_INFORMATION`,
`RISK_INDICATORS`, `INVALID_JSON`, `INVALID_SCHEMA`, `BAD_CITATION`,
`POLICY_BLOCK`, `TIMEOUT`, `TRANSIENT_FAILURE`, and `DELAYED_RESULT`. A
governance-owned runtime configuration selects the profile; an assessment
request cannot select it.

Governance has explicit configuration, self-test, policy, prompt-version,
publish/retire, kill-switch, and operations routes. Tenant governance mutations
emit safe events to `cdep.ai.governance.v1`; platform seed records remain
readable but cannot be changed through an organization-scoped mutation.

## Processing and provenance

Requests persist an assessment and exact input references before returning
`202`. A database-backed worker uses leases, bounded retries, cancellation, and
terminal failure states. Input preparation re-reads the authoritative Case and
Workflow versions and streams the exact canonical Evidence version through an
internal authenticated contract. SHA-256 is verified before use.

This implementation extracts bounded UTF-8 `text/plain` content. PDF and image
parsers are not implemented or claimed; those inputs are recorded as excluded
with `PARSER_NOT_IMPLEMENTED`. An assessment fails closed if no supported
content remains.

Raw mock output is encrypted with AES-256-GCM. Only strict normalized output is
returned publicly. Citations must refer to the pinned input set. HTML, hidden
reasoning/prompt disclosure, duplicate codes, extra fields, and decision-like
schema deviations are rejected.

## Human authority

Assessment output is decision support only. It cannot submit a recommendation,
approve, reject, calculate a credit score, or mutate a final decision.
Acceptance requires an explicit selection and creates only a Workflow draft.
Workflow rechecks state and version and stores assessment provenance. Human
review and submission remain separate Phase 4 actions.

## Operations

- Health: `/health/live`, `/health/startup`, `/health/ready`
- Metrics: `/metrics`
- Assessment events: `cdep.ai.assessment.v1`
- Governance events: `cdep.ai.governance.v1`
- Dead-letter topic: `cdep.ai.dlt.v1`
- Validation: `npm run validate:phase5`

The gateway applies bearer authentication, bounded bodies, and its global rate
limit before proxying the assessment and governance routes. Logs redact
authorization, cookies, bodies, and raw output.

## Deferred integration

No live Cortex or LLM call is implemented, attempted, or verified in Phase 5.
Integration remains deferred until the real versioned API, authentication,
timeout, retry, error, cancellation, and data-handling contract is supplied.
