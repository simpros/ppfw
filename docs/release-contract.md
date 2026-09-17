# Release artifact contract

This document is the stable contract between ppfw releases and the
canonical install script (`install.sh`). It defines which local-machine
targets are supported, how binaries are named, how checksums are published,
how the install script ships, and how stable releases are distinguished
from prereleases.

The machine-readable form of the target matrix lives in
`scripts/release-targets.json`. `tests/release-contract.test.ts` asserts
that this document, the JSON matrix, `install.sh`, and
`.github/workflows/release.yml` agree with each other.

## Supported targets

End-user distribution is binary-only for the native local machine
(CONTEXT.md: `local machine`, `end-user binary`). WSL2 is out of scope.
musl-specific Linux packaging is not a first-class guaranteed target;
Linux binaries target glibc.

| OS (`uname -s`) | Arch (`uname -m`) | Release asset |
| --- | --- | --- |
| Darwin | arm64 | `ppfw-darwin-arm64` |
| Darwin | x64 | `ppfw-darwin-x64` |
| Linux | x86_64 | `ppfw-linux-x64` |
| Linux | aarch64 / arm64 | `ppfw-linux-arm64` |

Asset names use GOOS-style OS identifiers (`darwin`, `linux`) and
`arm64` / `x64` arch identifiers. The version is carried by the GitHub
Release tag, not the filename, so every release ships the same four
asset names.

## How binaries are produced

Each target is built natively on its own GitHub-hosted runner
(cross-compilation is not used: `@opentui/core` ships per-platform
native packages, so a Linux runner cannot link the macOS binaries):

| Asset | Runner | Build |
| --- | --- | --- |
| `ppfw-darwin-arm64` | `macos-15` | `bun install` + `bun build --compile --outfile=dist/ppfw-darwin-arm64 ./src/main.ts` |
| `ppfw-darwin-x64` | `macos-15-intel` | `bun install` + `bun build --compile --outfile=dist/ppfw-darwin-x64 ./src/main.ts` |
| `ppfw-linux-x64` | `ubuntu-24.04` | `bun install` + `bun build --compile --outfile=dist/ppfw-linux-x64 ./src/main.ts` |
| `ppfw-linux-arm64` | `ubuntu-24.04-arm` | `bun install` + `bun build --compile --outfile=dist/ppfw-linux-arm64 ./src/main.ts` |

Local reproduction for the current platform only:

```bash
bun run release:build
```

## Checksums

Every release publishes `SHA256SUMS.txt` alongside the binaries, in
`shasum -a 256 -c` compatible two-column format:

```
<sha256>  <asset-filename>
```

The installer must verify the downloaded binary against this file and
hard-fail when the checksum is missing or mismatched (enforced in
#30). The file is generated in CI with `sha256sum` over the four
binaries.

## Canonical install script

`install.sh` at the repository root is the canonical install script
(CONTEXT.md: `install script`). The release workflow uploads the
`install.sh` from the tagged commit as a release asset, so the
bootstrap flow (`curl …/install.sh | sh`) always uses the script
versioned with the binaries it installs — never a moving-branch copy.

`install.sh` maps the local machine to an asset name with:

- `uname -s`: `Darwin` -> `darwin`, `Linux` -> `linux`, anything else unsupported
- `uname -m`: `arm64`/`aarch64` -> `arm64`, `x86_64`/`amd64` -> `x64`, anything else unsupported

## Stable releases vs prereleases

Distinguishability lives at the release level; the per-release asset
shape is identical so the installer needs no special cases:

- Tag `vMAJOR.MINOR.PATCH` (no hyphen, e.g. `v0.2.0`) -> GitHub Release
  with `prerelease: false`. This is a stable release.
- Tag `vMAJOR.MINOR.PATCH-<label>` (e.g. `v0.2.0-rc.1`) -> GitHub
  Release with `prerelease: true`. This is a prerelease.

The installer (see #30) defaults to the latest stable release via
`GET /repos/{owner}/{repo}/releases/latest` — an endpoint GitHub
resolves to the newest non-prerelease — and only considers prereleases
when the user opts in (`--prerelease` / `PPFW_PRERELEASE=1`), by paging
`GET /repos/{owner}/{repo}/releases` instead. An explicit
`--version vX.Y.Z` / `PPFW_VERSION=vX.Y.Z` selects that tag regardless
of channel.
