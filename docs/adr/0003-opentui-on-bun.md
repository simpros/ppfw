# opentui on Bun

ppfw's UI is built on **opentui** running on **Bun**. opentui's event-driven render loop rides Bun's event loop, so supervising `ssh` child processes alongside rendering fits its model, and its flagship app (OpenCode) is exactly ppfw's shape — a long-running, full-screen TUI driving background work. Bun is first-class for opentui (Node rendering needs bleeding-edge Node plus experimental flags), which also settles the runtime. The main risk is opentui's pre-1.0 API churn; mitigate by pinning the version.

**Considered options:** Ink (Node); bubbletea / ratatui / Textual (other languages). Full analysis on branch `research/opentui-framework`.
