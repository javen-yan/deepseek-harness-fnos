# DeepSeek Harness fnOS Full FPK

This repository packages DeepSeek Harness as a native fnOS app without Docker, `npx`, or install-time dependency downloads.

Project page: [https://javen-yan.github.io/deepseek-harness-fnos/](https://javen-yan.github.io/deepseek-harness-fnos/)

Local page source: [`site/index.html`](site/index.html)

Maintainer and publisher: [javen-yan](https://javen-yan.github.io/)

Current recommended version: `0.2.1-rc.2-1`.

Adapter notes for the upstream `0.2.x` changes (broken app-boot exports, browser
launch token, plugin compatibility): [`docs/upstream-0.2-adaptation.md`](docs/upstream-0.2-adaptation.md).

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

The build installs the exact runtime closure, asserts every physical runtime
gate, then boots the web profile in the build container: it runs the profile
bootstrap, starts `dsh web --port 0`, rejects any plugin that fails to activate,
exchanges the printed launch token for a browser cookie, and requires the
resulting index to contain `__DSH_BOOT__`. On npm 11.19+ the build passes
`--dangerously-allow-all-scripts` so native dependency install scripts still
run.

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

Upstream updates are handled by `Upstream Update PR`. It checks `npm view @deepseek-ai/dsh version` and `npm view dshmarket version` daily and can also be triggered manually. When a newer upstream runtime package exists, it opens a PR that updates `app/package.json`, `app/package-lock.json`, and `manifest`, then closes the bot PRs it supersedes. Every such PR runs `Validate Runtime`, which builds the runtime and runs the same boot/token smoke test before a human merges it.

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

The bootstrap is version-adaptive: it uses `removeLinkProjections` on app-boot
`0.1.7+`, `healProfilesModuleFallback` on `0.1.2–0.1.5`, and
`writeProfileBundles` when the runtime provides it. Because `0.1.7+` resolves
bundles from the profile instead of the installation closure, `dshmarket` is
exposed through `$DSH_HOME/profiles/node_modules` with a symlink to the bundled
copy. A real directory installed there by the user always wins.

Access is password based:

- `/fnos-access/login` requires the management password configured in the fnOS wizard.
- Login sets one HttpOnly `fnos_dsh_access` cookie and returns directly to the official DSH Web UI.
- DSH `0.1.2+` additionally requires a browser cookie minted from the launch token it prints at startup. The app captures that token into `TRIM_PKGVAR/gateway/dsh-launch-token` (mode 0600); the edge proxy adds it to the first index navigation that has no DSH cookie, then DSH sets its signed cookie. A stale DSH cookie is cleared once and retried.
- The edge proxy gates browser access and then forwards HTTP/WebSocket traffic to `127.0.0.1:3080` with loopback `Host` and `Origin`. DSH itself is started with `--no-open`.
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

## Troubleshooting

### "Failed to load plugins" / white screen after login

The white screen that appeared right after the password prompt was an edge-proxy
bug: DSH gzips the Web index, and the proxy injected the Web Crypto shim into
the compressed bytes while keeping `Content-Encoding: gzip`. Fixed in
`@fnos/dsh-fnos-access` commit `71d6239`; the runtime smoke test now drives the
proxy with `curl --compressed`.

### New Session fails with `agent-preset/invalid: persona ... already registered`

This means the runtime tree was installed **nested instead of hoisted**:
`node_modules/@deepseek-ai/dsh-system-prompt` and `dsh-persona` exist only under
`@deepseek-ai/dsh/node_modules/`. DSH then loads two prompt registries, and the
agent preset's `persona` row collides with the deployment persona section, so
every new Session is rejected.

Two ways to get there:

- `app/package-lock.json` was resolved by a different npm major than the build
  image (for example npm 10 on macOS vs npm 11 on `node:24-bookworm`), or
- the pinned DSH release itself resolves a nested tree (`0.2.1-rc.2` does).

`scripts/build-runtime.sh` now fails the build when
`node_modules/@deepseek-ai/dsh-system-prompt` is not at the top level, and
`scripts/dsh-version-policy.js` blocks releases known to nest. Regenerate the
lock **inside the build image** when bumping DSH:

```sh
docker run --rm --platform linux/amd64 -v "$PWD/app:/work" -w /work \
  node:24-bookworm bash -lc 'rm -f package-lock.json && npm install --package-lock-only --ignore-scripts'
```

### "Failed to load plugins" page

A "Failed to load plugins" page is a **third-party plugin** problem, not the
wrapper. The message names the plugin and the client module it could not
resolve. Plugins built for DSH `0.1.1-rc.2` still reference
`@deepseek-ai/dsh-client-runtime` and the `settingsScope` client service, both of
which DSH `0.2.x` removed. Remove the plugin from the web profile and restart
the app:

1. Stop the app in App Center.
2. Edit `TRIM_PKGVAR/profiles/dsh/profiles/web/package.json` and remove the
   plugin from both `dependencies` and `dsh.profile.bundles`.
3. Start the app. The plugin's files under `node_modules` can stay; they are not
   loaded once the manifest no longer names it.

Ask the plugin author to migrate to `@deepseek-ai/dsh-client-store` and the
current settings service, and to narrow `dsh.engines.dsh` to the versions the
plugin actually supports.
