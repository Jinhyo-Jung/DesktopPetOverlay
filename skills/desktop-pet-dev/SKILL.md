---
name: desktop-pet-dev
description: Execute the standard development workflow for this DesktopPetOverlay repository in WSL. Use when implementing or refactoring game features, running local checks, updating docs/CHANGE_LOG.md in Korean, and preparing commit-ready diffs.
---

# Desktop Pet Dev

## Workflow
1. Work in WSL paths (`/mnt/c/...`) for build and test commands.
2. Read requirement docs before coding:
- `docs/게임 요구사항 문서.md`
- `docs/육성형 게임 요구사항 문서.md`
3. Implement the requested code change.
4. Run local checks for touched scope (`npm run lint`, tests if present).
5. Append a timestamped Korean entry to `docs/CHANGE_LOG.md`.
6. Report changed files and include a concise diff summary.

## Command Set
- Install dependencies: `npm install`
- Run app: `npm run start`
- Lint: `npm run lint`
- Package build: `npm run make`

Run `scripts/run_workflow.sh` to execute the baseline sequence.

## Output Contract
1. State what changed and why.
2. Reference edited files explicitly.
3. Include verification commands run and outcomes.
4. Include next steps only if they are actionable.

## References
- Workflow details: `references/workflow.md`
