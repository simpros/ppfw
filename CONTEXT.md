# ppfw

ppfw manages SSH port forwards from a local macbook to remote dev boxes, driven by per-application config files, and maps friendly hostnames onto those ports.

## Language

### Discovery & config

**App**:
A project in the workspace that ships a `.ppfw.config` declaring its ports. One app per config file.
_Avoid_: project, service, repo

**Workspace root**:
The directory ppfw scans for `.ppfw.config` files.
_Avoid_: workspace (ambiguous), project dir

**Named port**:
A port an app declares by name (e.g. `frontend: 5173`). The number is both the remote and the local port.
_Avoid_: service, endpoint

**Remote**:
An `~/.ssh/config` host alias identifying a dev box. ppfw stores no host, user, port, or key for it.
_Avoid_: host, server, box, environment

**Default remote**:
The remote used when an app does not override it.
_Avoid_: primary remote

**Alias suffix**:
The hostname suffix used to derive alias names (`<port-name>.<app-name>.<suffix>`).
_Avoid_: domain, TLD

### Forwarding & aliasing

**Forward**:
An SSH local-forward that puts a tunnel behind a localhost port so the laptop reaches a remote service. Also the verb for creating one.
_Avoid_: tunnel (as the feature name), port-forward (ambiguous direction)

**Alias**:
A mapping from a friendly hostname to a localhost port. May stand alone with no tunnel behind it.
_Avoid_: hostname, shortcut

**Standalone alias**:
An alias with no forward behind it, pointing at a port a local service already owns.
_Avoid_: local alias

**Root proxy**:
The privileged local reverse proxy on `127.0.0.1:80` that resolves aliases by Host header.
_Avoid_: proxy (ambiguous)
