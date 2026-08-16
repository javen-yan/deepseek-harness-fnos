#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APPNAME="$(awk -F= '$1 == "appname" { print $2 }' "$ROOT_DIR/manifest")"
VERSION="$(awk -F= '$1 == "version" { print $2 }' "$ROOT_DIR/manifest")"
TARGET_PLATFORM="${TARGET_PLATFORM:-x86}"
case "$TARGET_PLATFORM" in
  x86)
    RUNTIME_ARCH="x64"
    ;;
  arm)
    RUNTIME_ARCH="arm64"
    ;;
  *)
    echo "Unsupported TARGET_PLATFORM: $TARGET_PLATFORM. Use x86 or arm." >&2
    exit 1
    ;;
esac
OUT_DIR="$ROOT_DIR/dist"
RUNTIME_DIR="$OUT_DIR/runtime"
PACK_DIR="$OUT_DIR/pack/$TARGET_PLATFORM"
STAGING_DIR="$PACK_DIR/$APPNAME"
OUT_FILE="$OUT_DIR/${APPNAME}-${VERSION}-${TARGET_PLATFORM}.fpk"
FNPACK_BIN="${FNPACK_BIN:-}"
RUNTIME_ARCHIVE="runtime-linux-${RUNTIME_ARCH}.tgz"
RUNTIME_SHA="${RUNTIME_ARCHIVE}.sha256"

mkdir -p "$OUT_DIR" "$PACK_DIR"

if [ ! -f "$RUNTIME_DIR/$RUNTIME_ARCHIVE" ] || [ ! -f "$RUNTIME_DIR/$RUNTIME_SHA" ]; then
  echo "Bundled runtime is missing for $TARGET_PLATFORM ($RUNTIME_ARCH)." >&2
  echo "Run: TARGET_ARCH=$RUNTIME_ARCH ./scripts/build-runtime.sh" >&2
  exit 1
fi

if [ -z "$FNPACK_BIN" ]; then
  if command -v fnpack >/dev/null 2>&1; then
    FNPACK_BIN="$(command -v fnpack)"
  elif [ -x "$ROOT_DIR/tools/fnpack" ]; then
    FNPACK_BIN="$ROOT_DIR/tools/fnpack"
  else
    echo "fnpack not found. Install it or set FNPACK_BIN=/absolute/path/to/fnpack." >&2
    echo "Download: https://static2.fnnas.com/fnpack/fnpack-1.2.3-darwin-arm64" >&2
    exit 1
  fi
fi

node - "$ROOT_DIR" "$STAGING_DIR" "$OUT_FILE" "$TARGET_PLATFORM" "$RUNTIME_DIR" "$RUNTIME_ARCHIVE" "$RUNTIME_SHA" <<'NODE'
const fs = require("fs");
const path = require("path");

const [, , rootDir, stagingDir, outFile, targetPlatform, runtimeDir, runtimeArchive, runtimeSha] = process.argv;
fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });
fs.rmSync(outFile, { force: true });

for (const entry of ["app", "cmd", "config", "wizard"]) {
  fs.cpSync(path.join(rootDir, entry), path.join(stagingDir, entry), {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      if (base === ".DS_Store") return false;
      if (base === "node_modules") return false;
      if (/^(node_modules|runtime)-linux-.*\.tgz(\.sha256)?$/.test(base)) return false;
      if (base === "dependency-sources.conf") return false;
      return true;
    },
  });
}

for (const file of ["manifest", "ICON.PNG", "ICON_256.PNG"]) {
  fs.copyFileSync(path.join(rootDir, file), path.join(stagingDir, file));
}

const manifestPath = path.join(stagingDir, "manifest");
const manifest = fs.readFileSync(manifestPath, "utf8")
  .replace(/^platform\s*=.*$/m, `platform=${targetPlatform}`);
fs.writeFileSync(manifestPath, manifest);

fs.copyFileSync(path.join(runtimeDir, runtimeArchive), path.join(stagingDir, "app", runtimeArchive));
fs.copyFileSync(path.join(runtimeDir, runtimeSha), path.join(stagingDir, "app", runtimeSha));
NODE

(
  cd "$PACK_DIR"
  "$FNPACK_BIN" build --directory "$STAGING_DIR"
)

if [ -f "$PACK_DIR/${APPNAME}.fpk" ]; then
  mv "$PACK_DIR/${APPNAME}.fpk" "$OUT_FILE"
elif [ ! -f "$OUT_FILE" ]; then
  echo "fnpack finished but no expected fpk was found in $PACK_DIR." >&2
  exit 1
fi

echo "$OUT_FILE"
