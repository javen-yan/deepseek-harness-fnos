# DeepSeek Harness fnOS Native FPK

This package wraps DeepSeek Harness for fnOS without Docker at runtime. The FPK is intentionally small: it contains the fnOS app frame, lifecycle scripts, package metadata, gateway proxy, and icons, then downloads a prebuilt Linux dependency archive during installation.

DeepSeek Harness still listens on `127.0.0.1:3080`. External access should go through the fnOS gateway entry at `/app/deepseek_harness/`, which proxies to the local service through `app.sock`.

## Dependency Archives

Build dependency archives on a development machine with Docker:

```sh
cd /Users/javen/Documents/Workspace/private/helper/fnos-app-build
TARGET_ARCH=x64 ./scripts/build-deps.sh
TARGET_ARCH=arm64 ./scripts/build-deps.sh
```

Outputs:

```text
dist/dependencies/node_modules-linux-x64.tgz
dist/dependencies/node_modules-linux-x64.tgz.sha256
dist/dependencies/node_modules-linux-arm64.tgz
dist/dependencies/node_modules-linux-arm64.tgz.sha256
```

Upload these four files to one or more HTTP(S) mirrors. Add one base URL per line to `app/dependency-sources.conf` before building the FPK, or set `DSH_DEPENDENCY_BASE_URLS` during install. The installer appends the archive and checksum names automatically, speed-tests every source with a 1 MB range request, downloads from the fastest successful source, verifies SHA256, then extracts to `TRIM_APPDEST/node_modules`.

## Build FPK

```sh
./scripts/build-fpk.sh
TARGET_PLATFORM=arm ./scripts/build-fpk.sh
```

`build-fpk.sh` requires the official `fnpack` tool. Install it in `PATH`, put it at `tools/fnpack`, or set `FNPACK_BIN=/absolute/path/to/fnpack`.

The generated FPK does not include scattered `node_modules` or dependency archives. That avoids appcenter getting stuck while unpacking thousands of small files and avoids native compilation on the NAS.

## GitHub Release Loop

This repository can publish itself from GitHub:

1. Push the source to `https://github.com/javen-yan/deepseek-harness-fnos`.
2. Merging to `main` runs `Tag Release`, which creates `v<manifest version>` if it does not already exist.
3. Pushing that tag runs `Release FPK`.
4. The release workflow builds Linux x64/arm64 dependency archives, builds x86/arm FPK files, and uploads all assets to the GitHub Release.
5. Each FPK embeds this release URL in `dependency-sources.conf`, so fnOS installs can download the matching dependency archive without manual URL configuration.

Upstream updates are handled by `Upstream Update PR`. It checks `npm view @deepseek-ai/dsh version` daily and can also be triggered manually. When a newer upstream version exists, it opens a PR that updates `app/package.json`, `app/package-lock.json`, and `manifest` using the version rule `<dsh-version>-1`.

Regenerate the black PNG icons from the DeepSeek Harness favicon with:

```sh
NODE_PATH=/path/to/sharp/node_modules node scripts/generate-icons.js
```

## Runtime

- fnOS dependency: `nodejs_v22`
- Harness bind: `127.0.0.1:3080`
- fnOS gateway URL: `/app/deepseek_harness/`
- Gateway socket: `TRIM_APPDEST/app.sock`
- Main log: `TRIM_PKGVAR/logs/deepseek-harness.log`
- Gateway log: `TRIM_PKGVAR/logs/gateway-proxy.log`
- Install log: `TRIM_PKGVAR/logs/install.log`

`192.168.1.32:3080` will not open because the service is deliberately bound to loopback. Do not change it to `0.0.0.0`; DeepSeek Harness rejects that mode because it can expose remote-code-execution capabilities.

After the main dependency installation succeeds, startup launches this background command:

```sh
dsh plugin --profile web add dshmarket
```

It uses a `corepack pnpm` wrapper, logs to `TRIM_PKGVAR/logs/dshmarket-install.log`, and never blocks the main app from running.
