# Reuse ~/.ssh/config and shell out to system ssh

A **remote is just an `~/.ssh/config` host alias**, and each forward is a system `ssh -L` child process, so host/user/port/keys/ProxyJump/known_hosts all resolve from the user's existing setup and ppfw does **zero credential handling**. We chose shelling out over an in-process SSH library because a library would force ppfw to parse ssh config and manage keys/agent itself — contradicting the "reuse ssh config, store no connection settings" decision — and `ssh2`-on-Bun is uncertain. `autossh` was rejected as redundant once ppfw supervises on its own (keepalive + exit monitoring + capped-backoff restart).

**Considered options:** in-process SSH library (re-implements config/identity handling); `autossh` (redundant).

**Consequences:** one process per forward (no ControlMaster in v1); each remote must already exist in `~/.ssh/config`; auth relies on ssh-agent/loaded keys.
