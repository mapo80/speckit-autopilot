# Changelog

All notable changes to speckit-autopilot will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.1.0] – 2026-03-14

### Added
- Initial release of speckit-autopilot Claude Code plugin
- Five namespaced skills:
  - `bootstrap-product` – parse product.md and produce roadmap/backlog/state
  - `ship-product` – iteratively ship every feature in the backlog
  - `ship-feature` – ship a single feature (greenfield or brownfield)
  - `resume-loop` – resume interrupted work after /compact or session restart
  - `status` – show a concise status report
- Four specialised agents:
  - `product-planner` – extracts epics, features and priorities from product.md
  - `brownfield-analyst` – inspects existing repos and produces brownfield-snapshot.md
  - `spec-auditor` – audits spec artifacts for completeness and consistency
  - `qa-gatekeeper` – runs lint, tests and coverage checks before marking a feature done
- Four compaction-safe hooks (SessionStart, PreCompact, PostCompact, TaskCompleted)
- Persistent file-based state in `docs/autopilot-state.json`
- Backlog management via `docs/product-backlog.yaml`
- Iteration log at `docs/iteration-log.md`
- Topological feature ordering with priority-based selection
- Brownfield repo detection and snapshot generation
- Acceptance gate with lint, test, and coverage threshold checks
- TypeScript strict mode throughout
- >= 90% test coverage (lines, functions, branches, statements)
- Example product (TaskBoard Lite) with expected roadmap and backlog
