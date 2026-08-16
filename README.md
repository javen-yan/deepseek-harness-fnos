# DeepSeek Harness fnOS Full FPK

This repository packages DeepSeek Harness as a native fnOS app without Docker, `npx`, or install-time dependency downloads.

The FPK is a full package: it embeds one Linux runtime archive for the target platform. During installation fnOS only verifies SHA256 and extracts that archive to `TRIM_APPDEST/runtime`.

Ordinary users should download only the matching Full FPK from GitHub Releases:

- `deepseek_harness-<version>-x86.fpk` for x86 fnOS
- `deepseek_harness-<version>-arm.fpk` for ARM fnOS

Runtime archives are uploaded as debug assets, but users do not need them.

## Runtime Model

The packaged runtime follows the same boundary used by `deepseek-harness-desktop`: runtime code, `node_modules`, CLI entrypoints, `pnpm`, and native modules remain a real physical file tree.

Installed layout:

```text
TRIM_APPDEST/
  runtime/
    package.json
    package-lock.json
    node_modules/
      .bin/dsh
      node-pty/build/Release/pty.node
      @deepseek-ai/dsh-web-frontend/dist/index.html
      @deepseek-ai/dsh-app-boot/lib/index.js
      pnpm/bin/pnpm.mjs
  proxy.js
  app.sock
```

The NAS never runs `npm install`, `npm ci`, or `npx`, so native modules are not compiled on the user device.

## Build Runtime

Build Linux runtime archives with Docker:

```sh
TARGET_ARCH=x64 ./scripts/build-runtime.sh
TARGET_ARCH=arm64 ./scripts/build-runtime.sh
```

Or build both:

```sh
TARGET_ARCH=all ./scripts/build-runtime.sh
```

Outputs:

```text
dist/runtime/runtime-linux-x64.tgz
dist/runtime/runtime-linux-x64.tgz.sha256
dist/runtime/runtime-linux-arm64.tgz
dist/runtime/runtime-linux-arm64.tgz.sha256
```

The build fails if the runtime is missing DSH CLI, web frontend, app boot, packaged `pnpm`, or `node-pty`.

## Build FPK

Build the full FPK after the matching runtime archive exists:

```sh
TARGET_PLATFORM=x86 ./scripts/build-fpk.sh
TARGET_PLATFORM=arm ./scripts/build-fpk.sh
```

`build-fpk.sh` requires the official `fnpack` tool. Install it in `PATH`, put it at `tools/fnpack`, or set `FNPACK_BIN=/absolute/path/to/fnpack`.

The generated FPK contains `runtime-linux-<arch>.tgz` and its `.sha256`, but no scattered `node_modules`.

## GitHub Release Loop

This repository publishes itself from GitHub:

1. Merging to `main` runs `Tag Release`, which creates `v<manifest version>` if it does not exist.
2. The tag runs `Release FPK`.
3. Ubuntu builds x64/arm64 runtime archives and checks their physical runtime gates.
4. macOS downloads the runtime archives, runs official `fnpack`, and builds x86/arm Full FPK files.
5. The release uploads two recommended FPK files plus runtime debug assets.

Upstream updates are handled by `Upstream Update PR`. It checks `npm view @deepseek-ai/dsh version` daily and can also be triggered manually. When a newer upstream version exists, it opens a PR that updates `app/package.json`, `app/package-lock.json`, and `manifest`.

## Runtime Behavior

- fnOS dependency: `nodejs_v22`
- Harness bind: `127.0.0.1:3080`
- fnOS gateway URL: `/app/deepseek_harness/`
- Gateway socket: `TRIM_APPDEST/app.sock`
- Install log: `TRIM_PKGVAR/logs/install.log`
- Main log: `TRIM_PKGVAR/logs/deepseek-harness.log`
- Gateway log: `TRIM_PKGVAR/logs/gateway-proxy.log`
- dshmarket log: `TRIM_PKGVAR/logs/dshmarket-install.log`

`192.168.1.32:3080` will not open because Harness deliberately binds to loopback. External access goes through the fnOS gateway. Do not change Harness to `0.0.0.0`; that exposes remote-code-execution capabilities.

After the main service starts, the app runs this in the background:

```sh
dsh plugin --profile web add dshmarket
```

It uses the packaged runtime `pnpm`, logs clearly, and never blocks the main app from running.

Regenerate the black PNG icons from the DeepSeek Harness favicon with:

```sh
NODE_PATH=/path/to/sharp/node_modules node scripts/generate-icons.js
```
