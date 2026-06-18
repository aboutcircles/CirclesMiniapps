# Company context

Drop company-wide documents here (markdown, text, ADRs, API conventions,
style guides…). Every file in this directory is mounted read-only into the
agent's workspace at `_context/` for every task, and the agent is told to
consult them.

Per-repository docs (architecture notes, CONTRIBUTING, etc.) are configured
separately on each codebase entry in `config/repos.yaml` (or via the UI), and
repos' own `AGENTS.md` / `CLAUDE.md` files are always picked up automatically.
