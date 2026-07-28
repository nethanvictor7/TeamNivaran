# Validation Workflow Service

Authoritative Phase 4 owner of versioned deterministic validation, reviewer
tasks, correction cycles, human recommendations, and immutable final human
decisions.

The service owns `cdep_workflow` and its isolated Prisma client. It stores only
safe Case and Evidence metadata snapshots. It never reads another service
database or stores Evidence content.

## Runtime

```bash
npm run prisma:deploy --workspace @cdep/validation-workflow-service
npm run build --workspace @cdep/validation-workflow-service
npm run start --workspace @cdep/validation-workflow-service
```

Health endpoints are `/health/live`, `/health/startup`, and `/health/ready`;
Prometheus metrics are exposed at `/metrics`.

Workflow events are published from the transactional outbox to
`cdep.workflow.events.v1`. Case and Evidence events are consumed idempotently
through `inbox_events`.

## Security boundary

All public APIs independently validate the RS256 access token and enforce the
exact permission. Case, Evidence, and current Identity eligibility checks use
the authenticated internal-service contract. Cross-organization resources
return `404`. Expected aggregate and task versions protect every mutable
transition.

Published definition versions, Validation Runs, reviews, recommendations, and
decisions are immutable. Four-eyes enforcement is repeated in the final
decision transaction; assignment never grants permission.
