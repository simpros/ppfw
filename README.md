# ppfw

ppfw manages SSH port forwards from a laptop to one or more remote dev boxes,
driven by per-application config files, and maps friendly hostnames onto those
ports. See [CONTEXT.md](CONTEXT.md) for the domain glossary and `docs/adr/`
for architecture decisions.

This is a vertical slice in progress: it discovers apps in a workspace, renders
them in a full-screen TUI, starts/stops forwards, and runs the root reverse
proxy on `127.0.0.1:80` (via one launch-time `sudo` escalation). `/etc/hosts`
alias resolution lands in a later slice.

## Requirements

- [Bun](https://bun.sh) >= 1.3

## Run

```bash
bun install
bun run start                     # scans the current directory
bun run start -- --workspace ~/dev
```

Or point the binary at a workspace directly:

```bash
bun src/main.ts --workspace ~/dev --remote devbox
```

## Global config

`~/.config/ppfw/config.yaml` (honors `$XDG_CONFIG_HOME`):

```yaml
workspace: ~/dev              # root scanned for .ppfw.config; defaults to cwd
default_remote: devbox        # fallback ~/.ssh/config host alias
alias_suffix: ppfw.localhost  # suffix for derived alias hostnames
```

If `alias_suffix` is unset it defaults to `ppfw.localhost` — a collision-safe
value, since bare `.local` is already owned by macOS mDNS.

CLI flags override the file: `--workspace`, `--remote`.

## App config

An app is any directory holding a `.ppfw.config`:

```yaml
name: kido              # optional; defaults to the directory name
remote: devbox-a        # optional; overrides default_remote
ports:
  frontend: 5173        # bare number = forward + derived alias
  api:
    port: 3232
    alias: api-v2.kido.example   # full-hostname override
  db:
    port: 5432
    alias: false        # forward only
  localui:
    port: 9000
    forward: false      # standalone alias, no forward
```

Derived aliases are `<port-name>.<app-name>.<alias_suffix>` — with the config
above, `frontend` becomes `frontend.kido.ppfw.localhost`.

## Develop

```bash
bun test          # unit tests
bun run typecheck # tsc --noEmit
```
