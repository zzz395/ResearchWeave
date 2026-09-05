# Changelog

All notable changes to ResearchWeave are documented in this file.

## [0.9.0] - Unreleased

Phase 9 implementation, including Phase 9C-7, is complete. The `0.9.0` package metadata is prepared while final checkpoint validation, release closure, and the `v0.9.0` tag remain pending.

### Added

- Space-authorized Agent Tasks with immutable prompts, durable retry Runs, cancellation, and ordered execution traces.
- A bounded production Agent Runtime with PostgreSQL claims, leases, heartbeats, fencing, crash recovery, and lifecycle-owned readiness.
- An immutable three-tool registry for arXiv search, Knowledge retrieval, and grounded answers backed by existing application services.
- Responsive Agent definition, task ledger, task history, Run trace, and server-validated evidence interfaces.
- Phase 9 PostgreSQL lifecycle and concurrency acceptance as a required continuous-integration gate.

### Changed

- Added Agents to Workspace navigation and URL-backed task filters, Run deep links, and Knowledge document citations.
- Expanded authorization regression coverage across all Agent Task and Run reads and commands after Space access revocation.
- Advanced the implementation roadmap to the completed Phase 9 implementation and prepared the `0.9.0` package metadata for pending release closure.

### Runtime impact

- The Agent client consumes the existing REST contracts through durable polling; no Agent-specific WebSocket protocol was added.
- Existing Agent Runtime, database schema, and REST contracts are unchanged by the Phase 9C-7 client implementation.

## [0.8.1] - 2026-09-03

### Added

- GitHub Actions quality gates for Node.js 22 lint, typecheck, automated tests, and production build.
- Isolated PostgreSQL 17/pgvector CI jobs for the Phase 6 indexing and Phase 7A retrieval smoke suites.

### Changed

- Aligned the README, implementation roadmap, and route documentation with the capabilities shipped through Phase 8B.
- Distinguished implemented Research and Space-scoped Knowledge routes from future Agents, Activity, comparison, and global overview routes.
- Aligned package metadata with the `0.8.x` release line.

### Runtime impact

- No application behavior, API contract, database schema, authorization rule, or realtime protocol changed in this release.

## [0.8.0] - 2026-09-03

### Added

- Integrated Research, Saved Papers, Space Overview, and Knowledge continuation workflows.
- Responsive workspace navigation and presentation across desktop, tablet, and mobile layouts.
- Reusable loading, empty, error, status, and workflow presentation helpers.
- Accessible focus behavior, semantic status messaging, and realtime chat announcements.
- Frontend regression coverage for navigation, workflow state, knowledge composition, and presentation behavior.

### Changed

- Refined the application hierarchy and responsive layout without changing backend APIs, database schema, authorization, or realtime architecture.

### Validation

- Phase 8B accessibility final validation passed.
- P8B-V-m04 and P8B-V-m05 were closed.
- lint, typecheck, automated tests, production build, and Git diff checks passed before release.
