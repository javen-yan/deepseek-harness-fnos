#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_ARCH="${TARGET_ARCH:-x64}"
OUT_DIR="$ROOT_DIR/dist/dependencies"
BUILD_DIR="$ROOT_DIR/dist/dependency-build"

case "$TARGET_ARCH" in
  x64)
    DOCKER_PLATFORM="linux/amd64"
    ;;
  arm64)
    DOCKER_PLATFORM="linux/arm64"
    ;;
  all)
    TARGET_ARCH=x64 "$0"
    TARGET_ARCH=arm64 "$0"
    exit 0
    ;;
  *)
    echo "Unsupported TARGET_ARCH: $TARGET_ARCH. Use x64, arm64, or all." >&2
    exit 1
    ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to build Linux dependency archives." >&2
  exit 1
fi

mkdir -p "$OUT_DIR" "$BUILD_DIR"
ARCHIVE="node_modules-linux-${TARGET_ARCH}.tgz"
WORK_DIR="$BUILD_DIR/$TARGET_ARCH"

node - "$ROOT_DIR/app" "$WORK_DIR" <<'NODE'
const fs = require("fs");
const path = require("path");

const [, , appDir, workDir] = process.argv;
fs.rmSync(workDir, { recursive: true, force: true });
fs.mkdirSync(workDir, { recursive: true });
for (const file of ["package.json", "package-lock.json"]) {
  fs.copyFileSync(path.join(appDir, file), path.join(workDir, file));
}
NODE

docker run --rm --platform "$DOCKER_PLATFORM" \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -v "$WORK_DIR:/work" \
  -w /work \
  node:22.18-bookworm \
  bash -lc 'npm ci --omit=dev --no-audit --no-fund && tar -czf /work/node_modules.tgz node_modules'

mv "$WORK_DIR/node_modules.tgz" "$OUT_DIR/$ARCHIVE"
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUT_DIR" && sha256sum "$ARCHIVE" > "$ARCHIVE.sha256")
else
  (cd "$OUT_DIR" && shasum -a 256 "$ARCHIVE" > "$ARCHIVE.sha256")
fi

node - "$WORK_DIR" <<'NODE'
const fs = require("fs");
fs.rmSync(process.argv[2], { recursive: true, force: true });
NODE

echo "$OUT_DIR/$ARCHIVE"
