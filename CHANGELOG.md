# Changelog

All notable changes to ResearchWeave are documented in this file.

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
