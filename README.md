# GLOS — Global Logistics Operating System

The open, Uber-like operating system for global trade: a neutral, intelligent
orchestration layer that connects any vetted logistics provider with any shipper
through a unified digital backbone.

## Source of truth
`GLOS_Build_Playbook_Compendium.docx` (FRD Compendium v2.0) — the authoritative
program playbook covering the 8 epic modules (M1–M8) plus the cross-cutting Smart
Settlement Engine (SSE).

## Build plan
See `05_engineering/implementation_plan.md` for the dependency-correct work breakdown:
`M1 → M2 (+M6) → M3 → M4 → SSE → M5 → M7`, across four delivery phases. Low-literacy,
inclusive UX is a non-negotiable cross-cutting requirement on every participant-facing surface.

## Repository layout
- `00_agent_orchestration/` — agent/config manifests
- `01_system_governance/` — branding, business dictionary, governance requirements
- `02_epic_domains/` — per-module epic definitions (M1–M8)
- `03_verification_suites/` — UAT scenarios
- `04_generated_sandbox/` — backend / frontend / mobile reference implementations
- `05_engineering/` — implementation plan and engineering notes
