## Agent skills

### Issue tracker

Issues are tracked as GitHub issues in `simpros/ppfw`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Pull requests

Open and describe every PR with the `visual-pr` skill vendored in this repo at
`.agents/skills/visual-pr/` — Why in one sentence, 1-3 special notes, and a
structural Change outline. Its frontmatter says explicit-invoke-only; that
default is overridden here: use it for every PR body. See
`docs/agents/pull-requests.md` for the publishing steps and the show-me-comment
rule.

### Comment style

Comments state only what the code cannot say. See `docs/agents/comment-style.md`.
