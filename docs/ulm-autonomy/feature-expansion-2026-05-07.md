# ULMCode Feature Expansion

Date: 2026-05-07

This pass implements 25 concrete feature upgrades from the harness research and follow-up prioritization, intentionally skipping claim and coverage ledgers for now.

## Added Features

1. Operation-local `memory.md` artifact.
2. `operation_memory` tool for reading/appending/replacing operation memory.
3. Operation memory injection into active ULM system context.
4. `operation_template` tool for template-based operation creation.
5. Eight operation templates: single URL web, external K-12 district, authenticated webapp, internal network, cloud posture, code audit, report-only, benchmark suite.
6. Trust level config and scheduling metadata: guided, moderate, unattended, lab_full.
7. Scan profile config and scheduling metadata: paranoid, stealth, balanced, aggressive, lab-insane.
8. Fast-edit `ULMconfig.toml` knobs for max parallel commands.
9. Fast-edit `ULMconfig.toml` knobs for per-host rate limit.
10. Fast-edit `ULMconfig.toml` knob for rate-limit spike stop behavior.
11. Fast-edit `ULMconfig.toml` knob for operation subagent no-tool timeout.
12. Operation-scoped subagent no-tool watchdog that stops stuck agents after configured idle tool activity.
13. Expanded tool inventory system/runtime profile.
14. Runtime kind detection for host, Docker, WSL, and Kali.
15. Package manager inventory.
16. Shell inventory.
17. Browser inventory.
18. Language runtime inventory.
19. Container runtime/tool inventory.
20. Network interface inventory.
21. `asset_graph` tool for attack-surface graphs.
22. `attack_chain` tool for linking findings/assets/evidence into risk paths.
23. `browser_evidence` tool for screenshot/DOM/trace/auth-state artifacts.
24. `operation_alert` tool for alert artifacts and future webhook/rich notification sinks.
25. `output_normalize` tool for reducing noisy command output into compact hosts/URLs/ports/interesting-line summaries.

## Report And Planning Upgrades

- `operation_plan` now records template, trust level, scan profile, browser-evidence intent, operation-memory intent, and report design profile.
- `operation_schedule` now writes trust level and scan profile into the lane graph.
- `report_outline` now supports design profile, coverage/browser/testing-limits section, and operator handoff checklist section.
- `report_render` now has a stronger print stylesheet and renders the new coverage/browser/testing-limits and handoff sections.

## Verification

- `bun run test test/tool/task.test.ts test/tool/registry.test.ts test/ulm/config.test.ts test/ulm/operation-graph.test.ts test/ulm/operation-extras.test.ts test/tool/tool_inventory.test.ts`
- `bun typecheck`

