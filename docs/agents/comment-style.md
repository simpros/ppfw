# Comment style

### Comment style rules

1. **A comment earns its place only when the code cannot say it.** If the line below
   already says it, delete the comment: no restating signatures, types or obvious
   control flow.
2. **Never cite tickets, issues, PRs/MRs, review feedback or people** — no `PRO-12`,
   `#128`, `issue #92`, "per review", "per the ticket". The tracker and git history
   hold that; the code holds the *reason*.
3. **No history narration.** "Previously…", "now uses X after the refactor", "fixed in
   v0.6.0" — git remembers; the file should read as the current truth.
4. **No commented-out code.** Git is the archive.
5. **An ADR reference is allowed only to mark a deliberate deviation/exception**, and the
   deviation must be named in the same line ("exempt from ADR-0007 because …"). Never as a
   substitute for stating the reason.
6. **Keep the why when it is real:** invariants, ordering/locking requirements, observed
   external behaviour and workarounds (say what was observed), security/privacy decisions,
   performance or safety tradeoffs, back-compat and migration constraints, unexplained
   magic constants.
7. **Public API docs keep the contract, drop the echo.** Keep non-obvious parameters,
   invariants, thrown errors and side effects; delete restatements of the signature and of
   the types.
8. **Banner/section comments only where they name a boundary the code cannot.** One-line
   module header is fine; a table of contents is not.
9. **One line beats three.** If the explanation needs a paragraph it is a decision → put it
   in `CONTEXT.md` / `docs/adr/` and leave at most a one-line pointer in the code.
10. **A comment that contradicts the code is a bug** — fix one of the two in the same
    change; never leave both standing.
11. **No editorializing or decoration:** no "ugly hack", "for now", "should be fine", no
    changelog notes, no emoji.

### Sharpening the rule

A header that names what the module is *for* is allowed; when it also cites a ticket,
**rewrite it to one line without the reference**. Do not delete it: the purpose is
context a reader cannot recover from the code. Delete only headers that are a table of
contents, pure narration, or a reference with no other content.

### Comment policy v2 — the default is now DELETE

The first sweep was already aggressive; this tightens what may survive.

1. **Delete is the default.** A comment survives only if it states something the code, its types, its tests, the docs or the tracker cannot say.
2. **Delete every file/module header that only names the file's contents** ("Routes for X", "Helpers for Y", "The children routes: …"). Keep a header only when it states a constraint the file cannot express (e.g. "all writes here go through `withPreviewLock`", "must stay dependency-free: imported by the CLI bootstrap").
3. **Delete JSDoc that echoes the signature or a type name.** Keep docstrings only on exported API/CLI surfaces, and only for non-obvious contract facts (invariant, throw, side effect, ordering).
4. **Delete comments in tests by default** — the test name and its assertions are the documentation. Keep one only where it records an *observed external behaviour* the test guards against (e.g. "a column-0 comment once ended the `|` block scalar early").
5. **Delete anything already recorded in an ADR, `CONTEXT.md`, `docs/`, or the tracker** — including ADR numbers used as shorthand for a rule. The ADR is the home of that rule; the code does not need the pointer.
6. **Survivors: at most one line each**, and only for one of: an invariant that is not visible in the code, an ordering or locking requirement, an external system's quirk plus its workaround, a security decision, a performance/safety tradeoff, the meaning of an otherwise unexplained constant, or a back-compat constraint.
7. **If you hesitate, delete.** A missing explanation is recoverable from git history and the tracker; a stale explanation that contradicts the code is not.
8. Unchanged and absolute: **no ticket/issue/PR/reviewer references, no commented-out code, no banner or section dividers, no history narration, no editorializing, no decoration.**
9. **In the PR body, list every comment that survived** with a one-clause justification ("kept: locking requirement", "kept: CI quirk observed on GitLab"). A survivor you cannot justify in one clause is a deletion you missed — the reviewer will treat it that way.
10. **Goal:** comment lines well under 1% of LOC (sprout was 6%, DCOS 4%). Report before/after counts in the PR body.
