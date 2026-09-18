# Pull requests

Every pull request is opened and described with the `visual-pr` skill vendored at
`.agents/skills/visual-pr/` (from [`humanlayer/skills`](https://github.com/humanlayer/skills),
pinned commit `ca7c8088`). The skill is the source of truth for the body shape;
this file carries the publishing steps and the fallback template.

The skill is the source of truth, not a copy of it:
`npx skills add humanlayer/skills --skill visual-pr`, then invoke `/visual-pr`
(or read `plugins/visual-pr/skills/visual-pr/SKILL.md` in
[`humanlayer/skills`](https://github.com/humanlayer/skills) at commit `ca7c8088`).
The skill owns the body template (`references/pr_description_template.md`) and the
visuals (`references/show-me.md`). Do not reimplement that template here — this
file's template is only the fallback for when the skill is unavailable.

## Body template

**Why the change** — one sentence. A reviewer reads it first and it decides
whether the rest is worth reading.

**Special things to note** — 1-3 bullets: reviewer warnings, migrations, compat
constraints, things deliberately left out, surprising decisions. `- None.` when
there are none.

**Change outline** — a compact structural view of the change, not prose and not a
file-by-file changelog. Use only the views that explain this pull request:

- call tree or component tree for a new flow,
- shallow file tree with responsibilities for a broad change,
- SQL schema and endpoint contract changes,
- key type changes,
- control/data flow pseudocode,
- `diff` blocks when an existing shape changes.

## Publishing

Save the description to `.humanlayer/tasks/{task-slug}/pr-description.md` when
that task directory exists, otherwise
`.humanlayer/tasks/pr-{number}/description.md`, then publish and re-read it:

```bash
gh pr edit <number> --body-file <path>          # GitHub
glab mr update <iid> --description-file <path>  # GitLab
```

## show-me is a comment, never a body section

`show-me` (same source repo) is used only when a pull request's design moves
**dramatically** after it was opened — a structural redesign, not local fixes —
and then **as a comment**. The body is never rewritten: it records the design the
pull request opened with.
