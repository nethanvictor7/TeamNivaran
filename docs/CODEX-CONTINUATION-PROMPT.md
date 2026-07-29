# Codex continuation prompt — CDEP Phase 2A

## PROJECT CONTEXT

Continue the existing CDEP monorepo. Phase 1 already contains the web portal,
API Gateway, Identity & Access Service, shared contracts, PostgreSQL migration,
and Dockerized PostgreSQL/Kafka/Redis/Garage/ClamAV.

Core principle:

> Evidence off-ledger. Trust on-ledger.

Do not re-architect the agreed ten-deployable boundary. PostgreSQL and Kafka run
in Docker locally and switch to managed services by environment configuration
only.

## GLOBAL RULES

- Use Node.js 24, TypeScript, NestJS, and Fastify for backend services.
- Use React, Vite, and the existing CDEP Enterprise Glass UI for the portal.
- Preserve strict service database ownership.
- Use UUIDs, UTC timestamps, and the existing correlated API error format.
- Every domain write that emits an event must write business state and an
  `outbox_events` row in one PostgreSQL transaction.
- Consumers must use an inbox/idempotency record before applying side effects.
- Never place complete evidence, PII, secrets, access tokens, or refresh tokens
  in Kafka events or logs.
- Every API operation must enforce JWT permission and organization scope at the
  destination service; UI permission gates are not security controls.
- Keep application code environment-neutral.
- Do not modify the accepted UI design tokens or introduce official bank logos.

## PURPOSE

Implement Phase 2A:

1. `case-service`
2. API Gateway routing for case endpoints
3. portal decision-case list and create flow backed by the real API
4. case domain events through PostgreSQL outbox and Kafka

Do not implement evidence upload or Hyperledger Fabric in this phase.

## ROUTES

Implement:

```text
POST   /api/v1/cases
GET    /api/v1/cases
GET    /api/v1/cases/:caseId
PATCH  /api/v1/cases/:caseId
POST   /api/v1/cases/:caseId/assignments
DELETE /api/v1/cases/:caseId/assignments/:assignmentId
```

Required permissions:

```text
case:create
case:read
case:update
case:assign
```

## BACKEND

- Create an independently buildable `apps/case-service`.
- Give it a dedicated `cdep_case` database and service credential.
- Add Prisma models for decision cases, parties, assignments, outbox events,
  and inbox events.
- Implement optimistic concurrency with an integer aggregate version.
- Reject organization-scope mismatch even when a user has the named
  permission.
- Propagate `x-correlation-id`.
- Add live, startup, and readiness health endpoints.
- Add a controlled migration and local Compose migration job.

## BUSINESS LOGIC

- Initial case status is `DRAFT`.
- Case reference is generated server-side and unique.
- Stable user UUIDs are stored for creator, updater, owner, and assignments.
- Email addresses are never used as foreign references.
- Case assignments do not grant platform permissions.
- Publish:

```text
case.created
case.updated
case.assignment.changed
case.status.changed
```

Use the versioned CDEP event envelope from `@cdep/contracts`.

## FRONTEND

- Replace the dashboard’s static priority case data with a TanStack Query
  client backed by `/api/v1/cases`.
- Wire the existing “New decision case” dialog to the create endpoint.
- Preserve the strict classic banking layout.
- Use glass only for navigation and summary surfaces.
- Keep tables and forms solid, high-contrast, and accessible.
- Add explicit loading, empty, error, and permission-denied states.
- Do not store complete evidence or refresh tokens in browser storage.

## REUSABLE COMPONENTS

Add or extract:

```text
PermissionGate
CaseStatusBadge
ApiProblemPanel
LoadingSkeleton
EmptyState
ConfirmDialog
```

## UI RULES

- Deep green, emerald, white, and light grey only for the core theme.
- Maintain WCAG AA text contrast.
- Use explicit status labels; do not rely on color alone.
- Keep animations restrained and honor reduced motion.
- Do not introduce neon effects, floating decorative widgets, or consumer-app
  styling.

## TEST CASES

- create a case with valid organization scope
- reject create without `case:create`
- reject cross-organization access
- reject stale aggregate version
- keep duplicate event processing idempotent
- persist case and outbox event atomically
- propagate correlation ID through HTTP and Kafka envelope
- portal renders loading, empty, success, validation error, and API error states

## DEFINITION OF DONE

- `case-service` builds and runs as its own Docker image.
- migration and seed/reference setup run as controlled jobs.
- Gateway validates JWT then routes `/api/v1/cases`.
- all destination endpoints enforce permission and organization scope.
- Kafka events validate against the shared schema.
- Compose can run with local PostgreSQL/Kafka or configured managed endpoints
  without application-code changes.
- type checks, unit tests, repository tests, and production builds pass.
- README and API/event documentation are updated.
