/**
 * A minimal parser for `~/.ssh/config` Host aliases.
 *
 * Semantics verified against OpenSSH's own reader: lines starting with `#`
 * are comments (a mid-line `#` is literal), keywords are case-insensitive,
 * arguments are whitespace-separated and may be double-quoted to contain
 * spaces, `Host=alias` is accepted, and there is no line continuation.
 * Patterns follow ssh_config(5): `*` matches any run, `?` matches exactly
 * one character, a leading `!` negates, and the first matching pattern in
 * a `Host` line decides the outcome. Each `Host` line is one pattern list;
 * an alias is present if any `Host` line matches it.
 */

export interface SshConfig {
  /** One pattern list per `Host` line, in file order. */
  patterns: string[][];
}

const HOST_KEYWORD = "HOST";

export function parseSshConfig(text: string): SshConfig {
  const patterns: string[][] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const tokens = tokenize(line);
    const first = tokens[0];
    if (first === undefined) continue;

    const eq = first.indexOf("=");
    const keyword = (eq === -1 ? first : first.slice(0, eq)).toUpperCase();
    if (keyword !== HOST_KEYWORD) continue;

    let args = tokens.slice(1);
    if (args[0] === "=") args = args.slice(1);
    if (eq !== -1) args = [first.slice(eq + 1), ...args];
    args = args.filter((arg) => arg !== "");

    if (args.length > 0) patterns.push(args);
  }

  return { patterns };
}

/**
 * True when the alias matches the Host line's pattern list, mirroring ssh's
 * first-match-wins rule: a matching `!`-prefixed pattern negates the list.
 */
export function patternsMatch(patterns: readonly string[], alias: string): boolean {
  for (const pattern of patterns) {
    const negated = pattern.startsWith("!");
    const body = negated ? pattern.slice(1) : pattern;
    if (globMatch(body, alias)) return !negated;
  }
  return false;
}

export function hasAlias(config: SshConfig, alias: string): boolean {
  return config.patterns.some((list) => patternsMatch(list, alias));
}

function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === "#" && !quoted && current === "") {
      break;
    }
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && (ch === " " || ch === "\t")) {
      if (current !== "") {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current !== "") tokens.push(current);
  return tokens;
}

function globMatch(pattern: string, name: string): boolean {
  if (pattern === "") return name === "";
  const head = pattern[0]!;
  if (head === "*") {
    return (
      globMatch(pattern.slice(1), name) ||
      (name !== "" && globMatch(pattern, name.slice(1)))
    );
  }
  if (head === "?") {
    return name !== "" && globMatch(pattern.slice(1), name.slice(1));
  }
  return name !== "" && name[0] === head && globMatch(pattern.slice(1), name.slice(1));
}
