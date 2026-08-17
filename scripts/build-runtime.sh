#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_ARCH="${TARGET_ARCH:-x64}"
OUT_DIR="$ROOT_DIR/dist/runtime"
BUILD_DIR="$ROOT_DIR/dist/runtime-build"
ACCESS_PLUGIN_SOURCE="${ACCESS_PLUGIN_SOURCE:-${GATEWAY_PLUGIN_SOURCE:-$ROOT_DIR/../dsh-remote-gateway}}"

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
  echo "docker is required to build Linux runtime archives." >&2
  exit 1
fi

mkdir -p "$OUT_DIR" "$BUILD_DIR"
ARCHIVE="runtime-linux-${TARGET_ARCH}.tgz"
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

LOCAL_ACCESS_TGZ=""
if [ -d "$ACCESS_PLUGIN_SOURCE" ] && [ -f "$ACCESS_PLUGIN_SOURCE/package.json" ]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required to pack local fnOS access plugin source: $ACCESS_PLUGIN_SOURCE" >&2
    exit 1
  fi
  pack_name="$(npm pack "$ACCESS_PLUGIN_SOURCE" --pack-destination "$WORK_DIR" --silent)"
  LOCAL_ACCESS_TGZ="$pack_name"
  node - "$WORK_DIR/package.json" "$LOCAL_ACCESS_TGZ" <<'NODE'
const fs = require("fs");
const [,, packageJsonPath, gatewayTgz] = process.argv;
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
delete packageJson.dependencies["@fnos/deepseek-harness-gateway"];
packageJson.dependencies["@fnos/dsh-fnos-access"] = `file:./${gatewayTgz}`;
fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
NODE
  echo "Using local fnOS access plugin package: $ACCESS_PLUGIN_SOURCE -> $LOCAL_ACCESS_TGZ"
fi

docker run --rm --platform "$DOCKER_PLATFORM" \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e LOCAL_ACCESS_TGZ="$LOCAL_ACCESS_TGZ" \
  -v "$WORK_DIR:/work" \
  -w /work \
  node:22.18-bookworm \
  bash -lc '
    set -euo pipefail
    if [ -n "${LOCAL_ACCESS_TGZ:-}" ]; then
      npm install --omit=dev --no-audit --no-fund
    else
      npm ci --omit=dev --no-audit --no-fund
    fi
    node node_modules/@fnos/dsh-fnos-access/scripts/patch-dsh-core.cjs node_modules
    test -x node_modules/.bin/dsh
    test -f node_modules/node-pty/build/Release/pty.node
    test -f node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html
    test -f node_modules/@deepseek-ai/dsh-app-boot/lib/index.js
    test -f node_modules/@fnos/dsh-fnos-access/lib/index.js
    test -f node_modules/@fnos/dsh-fnos-access/lib/edge-proxy.cjs
    test -f node_modules/pnpm/bin/pnpm.mjs
    node -e "require(\"./node_modules/node-pty\")"
    ! grep -q "fnOS patch: allow trusted-host authorities to access the Web configuration plane" node_modules/@deepseek-ai/dsh-client-connection/lib/index.js
    grep -q "\\[fnos-access patch\\] fallback gate" node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js
    grep -q "\\[fnos-access patch\\] api gate" node_modules/@deepseek-ai/dsh-client-connection/lib/index.js
    grep -q "\\[fnos-access patch\\] websocket gate" node_modules/@deepseek-ai/dsh-client-connection/lib/index.js
    grep -q "\\[fnos-access patch\\] boot graph prefix" node_modules/@deepseek-ai/dsh-client-modules/lib/index.js
    grep -q "\\[fnos-access patch\\] boot graph prefix source" node_modules/@deepseek-ai/dsh-client-modules/lib/index.js
    grep -q "\\[fnos-access patch\\] plugin bundle gate" node_modules/@deepseek-ai/dsh-client-modules/lib/index.js
    grep -q "\\[fnos-access patch\\] plugin events gate" node_modules/@deepseek-ai/dsh-client-hmr/lib/index.js
    tar -czf /work/runtime.tgz package.json package-lock.json node_modules
  '

mv "$WORK_DIR/runtime.tgz" "$OUT_DIR/$ARCHIVE"
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
