# Local fork of upstream `visual-pr`

Base: `humanlayer/skills@ca7c8088`, `plugins/visual-pr/skills/visual-pr`.
The `visual-pr` hash in `skills-lock.json` covers that upstream tree pre-fork.
Deliberate local divergences: always-on invocation (upstream is
explicit-invoke-only) and. Do not `skills add` over this path —
re-verifying the lock against these files will mismatch by design.
