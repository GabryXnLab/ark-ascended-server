#!/usr/bin/env bash
# Installa xaudio2_9.dll nella directory Win64 di ASA passata come $1.
# ARK 77.34 ha introdotto una regressione su Linux/Proton (in particolare con
# alcune mod): il runtime di riferimento cdp1337 installa xaudio2_9redist.dll
# dopo ogni update di SteamCMD.
# La DLL è un binario Microsoft: non viene redistribuita nell'immagine ma
# scaricata a runtime dal pacchetto NuGet ufficiale e tenuta in cache nel
# volume. Versione e hash sono fissati: un cambiamento upstream non può
# alterare silenziosamente il server.
set -euo pipefail

DEST_DIR="${1:?directory Win64 di destinazione richiesta}"
VERSION="${XAUDIO2_REDIST_VERSION:-1.2.11}"
SHA256="${XAUDIO2_REDIST_SHA256:-6226fa82a72dab312096dbfd46421c213e644aa5fcec83601e191ffa49f723f7}"
CACHE_DIR="${ARK_CACHE_DIR:-/data/cache}"
CACHED="$CACHE_DIR/xaudio2_9redist-${VERSION}.dll"

verified() {
  [[ -f "$1" ]] && echo "${SHA256}  $1" | sha256sum -c --quiet - 2>/dev/null
}

if ! verified "$CACHED"; then
  mkdir -p "$CACHE_DIR"
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  curl -fsSL "https://www.nuget.org/api/v2/package/Microsoft.XAudio2.Redist/${VERSION}" -o "$work/pkg.zip"
  unzip -p "$work/pkg.zip" 'build/native/release/bin/x64/xaudio2_9redist.dll' > "$work/xaudio2_9redist.dll"
  echo "${SHA256}  $work/xaudio2_9redist.dll" | sha256sum -c --quiet - \
    || { echo "[xaudio2] hash inatteso per XAudio2.Redist ${VERSION}: DLL scartata" >&2; exit 1; }
  mv "$work/xaudio2_9redist.dll" "$CACHED"
fi

install -m 644 "$CACHED" "$DEST_DIR/xaudio2_9.dll"
