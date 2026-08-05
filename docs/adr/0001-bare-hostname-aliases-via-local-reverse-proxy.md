# Bare-hostname aliases via a privileged local reverse proxy

Aliases resolve as bare hostnames (`http://frontend.kido.local`) with no typed port. Because `/etc/hosts`/DNS map a name to an **IP — not a port**, and browsers default to port 80, we run a single local **reverse proxy on `127.0.0.1:80`** that routes by Host header, and map every alias to `127.0.0.1` in a marker-delimited `/etc/hosts` block. This needs one launch-time root escalation: the proxy runs as a root child process, torn down at quit. We accepted the escalation because the bare hostname is the point of the feature; the no-root alternative (user types the port) defeated the purpose.

**Considered options:** typed-port aliases (no root, worse UX); per-loopback-IP binds (many root listeners); a persistent launchd helper (deferred).

**Consequences:** v1 is http-only — TLS on 443 would need per-alias certs; the alias feature depends on a privileged component.
