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
  node:24-bookworm \
  bash -lc '
    set -euo pipefail
    if [ -n "${LOCAL_ACCESS_TGZ:-}" ]; then
      npm install --omit=dev --no-audit --no-fund
    else
      npm ci --omit=dev --no-audit --no-fund
    fi
    node <<'"'"'NODE'"'"'
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const runtimeDir = process.cwd();
const runtimeRequire = createRequire(path.join(runtimeDir, "package.json"));
const dshPackage = runtimeRequire.resolve("@deepseek-ai/dsh/package.json");
const dshRequire = createRequire(dshPackage);

function assertFile(file, label) {
  if (!fs.existsSync(file)) {
    throw new Error(`${label} is missing: ${file}`);
  }
  console.log(`ok ${label}: ${file}`);
}

function resolveModule(name) {
  try {
    return runtimeRequire.resolve(name);
  } catch (error) {
    try {
      return dshRequire.resolve(name);
    } catch {
      throw error;
    }
  }
}

assertFile(path.join(runtimeDir, "node_modules/.bin/dsh"), "DSH CLI");
assertFile(path.join(runtimeDir, "node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html"), "DSH web frontend");
assertFile(resolveModule("@deepseek-ai/dsh-app-boot"), "DSH app boot");
assertFile(path.join(runtimeDir, "node_modules/@fnos/dsh-fnos-access/lib/edge-proxy.cjs"), "fnOS access edge proxy");
assertFile(path.join(runtimeDir, "node_modules/@fnos/dsh-fnos-access/lib/admin-auth.cjs"), "fnOS access admin auth");
assertFile(path.join(runtimeDir, "node_modules/dshmarket/cordis.patch.yml"), "bundled dshmarket");
assertFile(path.join(runtimeDir, "node_modules/pnpm/bin/pnpm.mjs"), "packaged pnpm");
assertFile(path.join(runtimeDir, "node_modules/node-gyp/bin/node-gyp.js"), "packaged node-gyp");
assertFile(path.join(runtimeDir, "node_modules/prebuild-install/bin.js"), "packaged prebuild-install");

require(path.join(runtimeDir, "node_modules/node-pty"));
const nativePty = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.name === "pty.node") nativePty.push(file);
  }
}
walk(path.join(runtimeDir, "node_modules/node-pty"));
if (!nativePty.length) throw new Error("node-pty native pty.node is missing");
console.log(`ok node-pty native: ${nativePty[0]}`);
NODE
    if [ -f node_modules/@deepseek-ai/dsh-client-connection/lib/index.js ]; then
      ! grep -q "fnOS patch: allow trusted-host authorities to access the Web configuration plane" node_modules/@deepseek-ai/dsh-client-connection/lib/index.js
    fi
    ! grep -R "\\[fnos-access patch\\]" node_modules/@deepseek-ai >/dev/null

    node node_modules/node-gyp/bin/node-gyp.js --version >/dev/null
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
