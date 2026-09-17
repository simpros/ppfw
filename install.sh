#!/bin/sh
# ppfw canonical install script.
#
# This is the release contract entrypoint (see docs/release-contract.md and
# scripts/release-targets.json): it maps the local machine to a release
# asset name and resolves the stable-vs-prerelease channel. The download,
# checksum-verification, and install/upgrade steps are implemented in
# https://github.com/simpros/ppfw/issues/30 with user-facing polish in
# https://github.com/simpros/ppfw/issues/31.
#
# Usage:
#   sh install.sh [--version vX.Y.Z] [--prerelease] [--print-target]
#
# Environment:
#   PPFW_VERSION     explicit release tag (e.g. v0.2.0); default: latest stable
#   PPFW_PRERELEASE  set to 1 to opt in to prereleases (same as --prerelease)
set -eu

REPO="simpros/ppfw"
VERSION="${PPFW_VERSION:-}"
PRERELEASE="${PPFW_PRERELEASE:-0}"

print_usage() {
  cat <<USAGE
Usage: install.sh [--version vX.Y.Z] [--prerelease] [--print-target]

  --version TAG   install an explicit release tag (default: latest stable)
  --prerelease    opt in to prereleases when resolving the latest release
  --print-target  print the release asset name for this machine and exit
USAGE
}

# Map uname output to a release asset name per docs/release-contract.md.
# Prints e.g. "ppfw-darwin-arm64". Exits non-zero on unsupported machines.
ppfw_asset_name() {
  os="${1:-$(uname -s)}"
  arch="${2:-$(uname -m)}"
  case "$os" in
    Darwin) os_id="darwin" ;;
    Linux) os_id="linux" ;;
    *) echo "ppfw: unsupported OS '$os' (supported: Darwin, Linux)" >&2; return 1 ;;
  esac
  case "$arch" in
    arm64|aarch64) arch_id="arm64" ;;
    x86_64|x64|amd64) arch_id="x64" ;;
    *) echo "ppfw: unsupported architecture '$arch' (supported: arm64, x64)" >&2; return 1 ;;
  esac
  echo "ppfw-${os_id}-${arch_id}"
}

# Resolve which release channel to install from: "stable" (default, via the
# /releases/latest endpoint which excludes prereleases) or "prerelease"
# (opt-in, via the /releases list). Explicit --version selects that tag
# regardless of channel.
ppfw_channel() {
  if [ -n "$VERSION" ]; then
    echo "version:$VERSION"
  elif [ "$PRERELEASE" = "1" ]; then
    echo "prerelease"
  else
    echo "stable"
  fi
}

PRINT_TARGET=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      if [ -z "$VERSION" ]; then echo "ppfw: --version requires a tag" >&2; exit 1; fi
      shift 2
      ;;
    --version=*) VERSION="${1#--version=}"; shift ;;
    --prerelease) PRERELEASE=1; shift ;;
    --print-target) PRINT_TARGET=1; shift ;;
    -h|--help) print_usage; exit 0 ;;
    *) echo "ppfw: unknown argument '$1'" >&2; print_usage >&2; exit 1 ;;
  esac
done

ASSET="$(ppfw_asset_name)"
CHANNEL="$(ppfw_channel)"

if [ "$PRINT_TARGET" = "1" ]; then
  echo "$ASSET"
  exit 0
fi

echo "ppfw: target $ASSET, channel $CHANNEL"
echo "ppfw: download, checksum verification, and install land in #30 (not yet implemented)" >&2
exit 3
