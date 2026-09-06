# Changelog

All notable changes to ResearchWeave are documented in this file.

## [0.10.0] - 2026-09-06

Phase 10 product integration is complete through Phase 10A–10D. The release adds durable global workspace read models and an evidence-bounded Saved Paper comparison workflow while keeping post-release audit, reproducibility, and portfolio work explicit.

### Added

- Durable authenticated Overview and Activity read models projected from PostgreSQL-backed product records.
- A global Overview and unified Activity experience with URL-backed category and Space filters.
- A Space-authorized comparison service for two to four unique current-Space Saved Papers using stored arXiv metadata and abstracts.
- A Space-scoped Paper Comparison interface with URL-restored selection and local, ephemeral results.
- Phase 10A PostgreSQL read-model acceptance as a required continuous-integration gate.

### Changed

- Authenticated entry, login continuation, registration continuation, and primary navigation now incorporate Overview and Activity.
- Saved Papers now provides the explicit entry to the Space-scoped comparison workflow.
- Public documentation and package metadata are aligned with the capabilities delivered through Phase 10A–10D.

### Runtime impact

- Added `GET /api/v1/activity`, `GET /api/v1/overview`, and `POST /api/v1/spaces/:spaceId/paper-comparisons`.
- Activity pagination uses stable reverse-keyset ordering with opaque filter-bound cursors and page-level authorization checks.
- Paper comparison requires current Space membership and two to four unique Saved Papers from that Space.
- Comparison evidence is limited to stored arXiv metadata and abstracts; generated frontend results are local and are not persisted as history or comparison IDs.
- Phase 10 comparison adds no database migration and no Agent tool.

### Validation

- Lint, typecheck, automated tests, production build, and Git diff checks pass for the release-closure baseline.
- GitHub CI includes isolated PostgreSQL gates for Phase 6, Phase 7A, Phase 9, and Phase 10A.
- Browser end-to-end validation, whole-repository security audit, clean-machine reproduction, and formal performance or retrieval evaluation remain post-release work.

## [0.9.0] - 2026-09-05

Phase 9 implementation, including Phase 9C-7, is complete. Final checkpoint validation passed, release closure is complete, and the baseline is established as `v0.9.0`.

### Added

- Space-authorized Agent Tasks with immutable prompts, durable retry Runs, cancellation, and ordered execution traces.
- A bounded production Agent Runtime with PostgreSQL claims, leases, heartbeats, fencing, crash recovery, and lifecycle-owned readiness.
- An immutable three-tool registry for arXiv search, Knowledge retrieval, and grounded answers backed by existing application services.
- Responsive Agent definition, task ledger, task history, Run trace, and server-validated evidence interfaces.
- Phase 9 PostgreSQL lifecycle and concurrency acceptance as a required continuous-integration gate.

### Changed

- Added Agents to Workspace navigation and URL-backed task filters, Run deep links, and Knowledge document citations.
- Expanded authorization regression coverage across all Agent Task and Run reads and commands after Space access revocation.
- Advanced the implementation roadmap through the completed Phase 9 release closure at `v0.9.0`.

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
