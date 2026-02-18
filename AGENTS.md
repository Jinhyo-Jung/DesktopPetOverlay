# AGENTS.md

## Project Operating Rules

1. Development environment
- Use WSL for all development tasks on Windows.
- Prefer running git and build/test commands through WSL.

2. Change history management
- Record all meaningful changes in docs/CHANGE_LOG.md.
- Every log entry must include a timestamp.

3. GitHub sync
- After completing changes, commit and push to GitHub (origin).

4. Conversation result with diff
- When a change is completed, show the resulting diff in the chat.

5. Web search policy
- Web search is allowed.
- Use web search when up-to-date or external verification is needed.

6. CHANGE_LOG language
- From now on, write all new entries in `docs/CHANGE_LOG.md` in Korean.

7. Documentation writing style
- Write all new/updated documents in a top-down style (state conclusion first, then details).

8. Feature baseline document (mandatory)
- Before implementing, deleting, or modifying any feature, read `docs/specs/DesktopPetOverlay-실구현-기능-기준서.md` first.
- After changes, verify no regression against that baseline document and update the document in the same commit if behavior changed.
