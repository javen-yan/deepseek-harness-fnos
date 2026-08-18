# DeepSeek Harness fnOS Full FPK

This repository packages DeepSeek Harness as a native fnOS app without Docker, `npx`, or install-time dependency downloads.

Project page: [https://javen-yan.github.io/deepseek-harness-fnos/](https://javen-yan.github.io/deepseek-harness-fnos/)

Local page source: [`site/index.html`](site/index.html)

Maintainer and publisher: [javen-yan](https://javen-yan.github.io/)

Current recommended version: `0.1.0-rc.7-7`.

The FPK is a full package: it embeds one Linux runtime archive for the target platform. During installation fnOS only verifies SHA256 and extracts that archive to `TRIM_APPDEST/runtime`.

Ordinary users should download only the matching Full FPK from GitHub Releases:

- `deepseek_harness-<version>-x86.fpk` for x86 fnOS
- `deepseek_harness-<version>-arm.fpk` for ARM fnOS

Runtime archives are uploaded as debug assets, but users do not need them.

## Install Prerequisites

Before installing the FPK, SSH into the fnOS NAS and prepare the plugin build
environment:

```sh
sudo apt update && sudo apt install -y build-essential python3 make gcc g++ pkg-config
```

The core DSH runtime is already packaged in the FPK, so installation does not
run `npm install` or compile the bundled app. These system tools are required
later when users install DSH plugins that contain native Node.js addons.

The app declares `nodejs_v24` as a fnOS dependency. App Center installs or
enables that dependency, while the command above prepares the native build
toolchain used by plugin installation.

## Configuration Guide

Recommended fnOS runtime settings:

| Field | Recommended value | Notes |
| --- | --- | --- |
| Management password | Set your own password, at least 8 characters | Used to log in to the DeepSeek Harness access entry. Do not reuse your NAS account password. |
| Plugin npm registry | `https://registry.npmmirror.com` | Used by the plugin market and third-party plugin installs. Empty uses the same default. |
| GitHub accelerator | `https://gh-proxy.com/` | URL prefix for GitHub tarball downloads. `https://github.com/...` becomes `https://gh-proxy.com/https://github.com/...`. Use `disabled` for direct GitHub access. |

Users in mainland China should normally keep the default npm registry and
GitHub accelerator. Users with reliable direct GitHub access can set the
accelerator to `disabled`.

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
      dshmarket/
        cordis.patch.yml
      node-pty native module
      @deepseek-ai/dsh-web-frontend/dist/index.html
      @deepseek-ai/dsh-app-boot/lib/index.js
      pnpm/bin/pnpm.mjs
      node-gyp/bin/node-gyp.js
      prebuild-install/bin.js
  proxy.js
```

The NAS never runs `npm install`, `npm ci`, or `npx` to build the core runtime. Third-party DSH plugins installed later use the bundled `pnpm`, but native builds rely on the NAS system environment prepared before installation.

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

The build fails if the runtime is missing DSH CLI, web frontend, app boot, packaged `pnpm`, `node-gyp`, `prebuild-install`, or `node-pty`.

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

- fnOS dependency: `nodejs_v24`
- NAS build tools required for plugin native builds: `python3`, `make`, `gcc`, `g++`, and `pkg-config`
- Harness bind: `127.0.0.1:3080`
- Gateway entry: `http://<NAS_IP>:3081/`
- fnOS App Center entry: one URL entry, port `3081`, path `/`
- Install log: `TRIM_PKGVAR/logs/install.log`
- Main log: `TRIM_PKGVAR/logs/deepseek-harness.log`
- Gateway log: `TRIM_PKGVAR/logs/gateway-proxy.log`
- Gateway access log: `TRIM_PKGVAR/logs/gateway-access.log`
- Profile bootstrap log: `TRIM_PKGVAR/logs/dsh-profile-bootstrap.log`

`192.168.1.32:3080` will not open because Harness deliberately binds to loopback. External access goes through the bundled fnOS access package.

Gateway/access source is intentionally maintained separately. It lives in [`javen-yan/dsh-remote-gateway`](https://github.com/javen-yan/dsh-remote-gateway) and is consumed as the npm package `@fnos/dsh-fnos-access`.

`build-runtime.sh` uses the sibling directory `../dsh-remote-gateway` when it exists, packing it into a temporary npm tarball before Docker builds the Linux runtime. If the sibling directory is absent, the build falls back to the Git dependency pinned by `app/package-lock.json`.

The fnOS App Center entry is a single URL entry with port `3081` and path `/`.
The install/config wizard stores the management password, npm registry, and an
optional GitHub download accelerator. Extra user directories should be granted
from the fnOS app settings "Access Permissions" page, the same model used by
apps such as Gitea.

The app writes a private `pnpm` wrapper into `TRIM_PKGTMP/bin` before DSH
starts and prepends that directory to `PATH`, so the plugin market never needs
global pnpm or write access to the system Node directory. Node and native build
tools come from the NAS environment. The web profile's `pnpm-workspace.yaml` is
scoped to the app profile and sets `dangerouslyAllowAllBuilds: true` for DSH
plugin compatibility. The configured npm registry is written to the profile
`.npmrc`; the default is `https://registry.npmmirror.com`.

GitHub archive downloads are handled separately from npm registry downloads.
The private pnpm wrapper loads `app/github-download-shim.cjs` and rewrites
GitHub download hosts such as `github.com`, `codeload.github.com`, and
`raw.githubusercontent.com` through `FNOS_GITHUB_DOWNLOAD_PROXY`. The default is
`https://gh-proxy.com/`, so ordinary users do not need to configure a local
proxy just to install plugins that reference GitHub tarballs. Leave the wizard
field empty to keep the default accelerator, or set it to `disabled` to use
direct GitHub downloads.

For networks that require a real proxy, `HTTP_PROXY`, `HTTPS_PROXY`, and
`NO_PROXY` can still be provided through the app environment or gateway config.
These values are exported in both upper and lower case and are also written to
the profile `.npmrc`, so pnpm, npm, node-gyp, and prebuild installers can use
the same proxy configuration.

Before DSH starts, `app/profile-bootstrap.mjs` initializes the official web
profile with the DSH app-boot helpers, mounts the bundled `dshmarket` bundle,
and removes legacy fnOS gateway/profile plugin entries. The bundled plugin
market is not installed with `dsh plugin add` during startup; user-installed
market plugins use the bundled pnpm and registry configuration.

Access is password based:

- `/fnos-access/login` requires the management password configured in the fnOS wizard.
- Login sets one HttpOnly `fnos_dsh_access` cookie and returns directly to the official DSH Web UI.
- The edge proxy gates browser access and then forwards HTTP/WebSocket traffic unchanged to `127.0.0.1:3080` with loopback `Host` and `Origin`.
- The edge proxy injects only a small Web Crypto compatibility shim into HTML for LAN HTTP browsers. It provides `crypto.randomUUID` and `crypto.getRandomValues` before the DSH boot script runs.

Verified on an x86 fnOS device:

- App Center only shows `DeepSeek Harness`.
- The app listens on `0.0.0.0:3081`; DSH itself stays on `127.0.0.1:3080`.
- Authenticated HTML contains the Web Crypto compatibility shim before `window.__DSH_BOOT__`.

Writable user data starts with fnOS data-share directories declared in `config/resource`:

- `deepseek-harness/workspace` - the default agent working directory.
- `deepseek-harness/extensions` - a user-visible place for extension packages,
  import files, and plugin artifacts.

Additional writable directories can be added from the fnOS app settings access
permission page. Granted directories are passed by fnOS and validated on startup
before DSH starts. DSH profiles, credentials, config, and cache stay in the app's
private var directory rather than being exposed as default data-share folders.

Do not change Harness to `0.0.0.0`; that exposes remote-code-execution capabilities.

Regenerate the black PNG icons from the DeepSeek Harness favicon with:

```sh
NODE_PATH=/path/to/sharp/node_modules node scripts/generate-icons.js
```
