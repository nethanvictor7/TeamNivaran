# ADR 0017: Immutable Workflow definition pinning

Published Workflow definition versions are immutable, and every instance pins
one exact version for its lifetime. Policy changes create a new version and do
not reinterpret active or historical decisions.
