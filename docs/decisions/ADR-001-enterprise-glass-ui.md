# ADR-001: Enterprise Glass UI

## Status

Accepted — 2026-07-23

## Decision

The CDEP portal uses a restrained glassmorphism treatment within a strict,
classic enterprise banking layout.

- Deep green, emerald, white, and light grey form the core palette.
- Navigation, summary cards, and non-critical surfaces may use subtle blur,
  translucent borders, and shallow elevation.
- Tables, forms, audit records, evidence details, and security controls use
  solid high-contrast surfaces for readability.
- Typography, spacing, and interaction patterns remain conservative and
  operationally focused.
- The theme is Lloyds Banking-inspired, but CDEP uses original branding and
  does not copy logos, protected marks, or proprietary assets.

## Consequences

All new UI modules must use shared design tokens. Decorative effects cannot
reduce contrast, obscure status, or replace explicit labels.
