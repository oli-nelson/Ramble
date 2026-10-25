#!/usr/bin/env bash
# Archive a native installer; do not ship the fake harness or debug binaries.
set -Eeuo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$script_dir/release-version.sh"
[[ $# == 2 ]] || { echo 'Usage: package-release.sh <version> <platform>' >&2; exit 1; }
version=$(release_version "$1")
platform=$2
cd "$script_dir/.."
case "$platform" in
  macos-x64) target=x86_64-apple-darwin; kind=dmg; extension=dmg ;;
  macos-arm64) target=aarch64-apple-darwin; kind=dmg; extension=dmg ;;
  windows-x64) target=x86_64-pc-windows-msvc; kind=nsis; extension=exe ;;
  *) echo 'error: unsupported release platform' >&2; exit 1 ;;
esac
shopt -s nullglob
installers=(src-tauri/target/"$target"/release/bundle/"$kind"/*."$extension")
[[ ${#installers[@]} == 1 && -s ${installers[0]} ]] || { echo 'error: expected exactly one nonempty native installer' >&2; exit 1; }
mkdir -p artifacts/release
tar -czf "artifacts/release/ramble-$version-$platform.tar.gz" \
  -C "$(dirname "${installers[0]}")" "$(basename "${installers[0]}")"
tar -tzf "artifacts/release/ramble-$version-$platform.tar.gz"
