# SSH config dialect (OpenSSH Host-alias subset)

Verified against OpenSSH's own reader. The parser in `src/ssh/config.ts`
implements exactly this subset:

- Lines starting with `#` are comments; a mid-line `#` is literal.
- Keywords are case-insensitive; arguments are whitespace-separated and may
  be double-quoted to contain spaces.
- `Host=alias` is accepted; there is no line continuation.
- Patterns follow ssh_config(5): `*` matches any run, `?` matches exactly
  one character, a leading `!` negates, and the first matching pattern in
  a `Host` line decides the outcome.
- Each `Host` line is one pattern list; an alias is present if any `Host`
  line matches it.
