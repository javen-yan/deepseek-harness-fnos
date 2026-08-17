# DeepSeek Harness fnOS Full FPK

This repository packages DeepSeek Harness as a native fnOS app without Docker, `npx`, or install-time dependency downloads.

Project page: [https://javen-yan.github.io/deepseek-harness-fnos/](https://javen-yan.github.io/deepseek-harness-fnos/)

Local page source: [`site/index.html`](site/index.html)

Maintainer and publisher: [javen-yan](https://javen-yan.github.io/)

Current recommended version: `0.1.0-rc.6-17`.

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
      @fnos/dsh-fnos-access/
        package.json
        lib/edge-proxy.cjs
        lib/admin-auth.cjs
      node-pty/build/Release/pty.node
      @deepseek-ai/dsh-web-frontend/dist/index.html
      @deepseek-ai/dsh-app-boot/lib/index.js
      pnpm/bin/pnpm.mjs
  proxy.js
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
- Gateway entry: `http://<NAS_IP>:3081/`
- fnOS App Center entry: one URL entry, port `3081`, path `/`
- Install log: `TRIM_PKGVAR/logs/install.log`
- Main log: `TRIM_PKGVAR/logs/deepseek-harness.log`
- Gateway log: `TRIM_PKGVAR/logs/gateway-proxy.log`
- Gateway access log: `TRIM_PKGVAR/logs/gateway-access.log`
- dshmarket log: `TRIM_PKGVAR/logs/dshmarket-install.log`

`192.168.1.32:3080` will not open because Harness deliberately binds to loopback. External access goes through the bundled fnOS access package.

Gateway/access source is intentionally maintained separately. It lives in [`javen-yan/dsh-remote-gateway`](https://github.com/javen-yan/dsh-remote-gateway) and is consumed as the npm package `@fnos/dsh-fnos-access`.

`build-runtime.sh` uses the sibling directory `../dsh-remote-gateway` when it exists, packing it into a temporary npm tarball before Docker builds the Linux runtime. If the sibling directory is absent, the build falls back to the Git dependency pinned by `app/package-lock.json`.

The fnOS App Center entry is a single URL entry with port `3081` and path `/`.
The install/config wizard only stores the management password. Extra user
directories should be granted from the fnOS app settings "Access Permissions"
page, the same model used by apps such as Gitea.

Access is password based:

- `/fnos-access/login` requires the management password configured in the fnOS wizard.
- Login sets one HttpOnly `fnos_dsh_access` cookie and returns directly to the official DSH Web UI.
- The edge proxy gates browser access and then forwards HTTP/WebSocket traffic unchanged to `127.0.0.1:3080` with loopback `Host` and `Origin`.
- The edge proxy injects only a small `crypto.randomUUID` polyfill into HTML for LAN HTTP browsers. The polyfill is inserted immediately after `<head>` so it runs before the DSH boot script.

Verified on an x86 fnOS device:

- App Center only shows `DeepSeek Harness 端口入口`.
- The app listens on `0.0.0.0:3081`; DSH itself stays on `127.0.0.1:3080`.
- Authenticated HTML contains the `crypto.randomUUID` polyfill before `window.__DSH_BOOT__`.

Writable user data starts with fnOS data-share directories declared in `config/resource`:

- `deepseek-harness/workspaces`
- `deepseek-harness/profiles`
- `deepseek-harness/exports`

Additional writable directories can be added from the fnOS app settings access
permission page. Granted directories are passed by fnOS and validated on startup
before DSH starts.

Do not change Harness to `0.0.0.0`; that exposes remote-code-execution capabilities.

After the main service starts, the app runs this in the background:

```sh
dsh plugin --profile web add dshmarket
```

It uses the packaged runtime `pnpm`, logs clearly, and never blocks the main app from running.

Regenerate the black PNG icons from the DeepSeek Harness favicon with:

```sh
NODE_PATH=/path/to/sharp/node_modules node scripts/generate-icons.js
```
