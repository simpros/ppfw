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

### Applying the rules

Notes below the rules, subordinate to them: if a note ever disagrees with a
rule above, the rule wins. Delete is the default — a comment survives only
if it states something the code, its types, its tests, the docs or the
tracker cannot say (rule 1).

- Headers: a header that names what the module is for stays only as one
  line with no ticket reference (rule 2); a header that only labels the
  file's contents or lists its sections goes (rule 8). A header survives
  as-is only when it states a constraint the file cannot express.
- Docstrings: keep them only on exported API/CLI surfaces, and only for
  non-obvious contract facts — invariant, throw, side effect, ordering
  (rule 7).
- Tests: the test name and its assertions are the documentation; keep a
  comment only where it records an observed external behaviour the test
  guards against (rule 6).
- Decisions: anything needing a paragraph belongs in `CONTEXT.md` /
  `docs/adr/`, leaving at most a one-line pointer in the code (rule 9).
  An ADR number appears only on the same line as a named deliberate
  deviation (rule 5), never as shorthand for a rule.
- Survivors are at most one line each (rule 9). If you hesitate, delete:
  a missing explanation is recoverable from git history; a stale one that
  contradicts the code is not (rule 10).
- In the PR body, list every surviving comment with a one-clause
  justification and report before/after comment-line counts.
