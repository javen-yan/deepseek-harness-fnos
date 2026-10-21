# 上游 DSH 0.2 适配记录

本文记录 fnOS 封装层与上游 DeepSeek Harness 的耦合点、`0.1.2-rc.1 → 0.2.1-rc.2` 之间
的破坏性变更，以及本仓库采取的适配策略。原则：**能用上游公开机制的，一律换成上游机制；
上游没有替代方案的，保留我们自己的适配，但把耦合收敛到一个函数里。**

## 1. 结论

- 上游改造幅度很大：`0.1.7-rc.2` 是一次 app-boot / CLI / 模块解析的大断点，`0.2.1-alpha.1`
  又改了 Web 监听与信任模型，`0.2.1-alpha.3` 引入插件兼容性准入。
- 自动更新 PR 从 `0.1.7-rc.2` 开始就**不可能直接可用**：`profile-bootstrap.mjs` 在启动时
  调用了一个已被删除的导出，进程直接崩溃。
- 另外发现一个与版本无关的**既有线上故障**：DSH `0.1.2+` 的 Web UI 必须先用启动 token
  换取浏览器 cookie；我们的边缘代理从未注入 token，所以全新浏览器打开入口只会得到
  `401 dsh web authentication required`。
- 构建链路还有一处静默风险：`node:24-bookworm` 里的 npm ≥ 11.19 默认**不执行依赖的
  install scripts**，会漏掉原生模块的准备步骤。已显式放开。

## 2. 上游断点时间线

| 版本 | 破坏点 | 对我们的影响 |
| --- | --- | --- |
| `0.1.2-rc.1` | 浏览器 launch-token + 签名 cookie 认证 | 我们的网关只做密码登录，没有 token 交换 → 入口 401 |
| `0.1.7-rc.2` | 删除 `healProfilesModuleFallback`，改用 `removeLinkProjections`；`initProfile` 去掉 `patchReload`；`dsh` 包新增 `exports` 映射，去掉 `web` 子命令（保留 `dsh web` 别名） | bootstrap 直接 `TypeError` 崩溃；profile 里的第三方 bundle 无法解析 |
| `0.2.0-rc.2` | 子路径插件展示元数据改读 `locale/*.json` + `icon` 导出 | 只影响插件作者，不影响我们 |
| `0.2.1-alpha.1` | `webRuntime` 服务 / `web-runtime` 行被 `webStartup` 取代；监听地址禁止通配；新增 `--public-url` / `--tls-cert` / `--tls-key` | 我们本来就绑 `127.0.0.1`；`--trusted-host` 仍可用 |
| `0.2.1-alpha.3` | 兼容性先读 `engines.dsh`，否则读 `dsh-peer`；新增 `compatibility.json` 精确版本豁免 | 第三方插件版本不匹配时会被拒绝启动，需要显式处理 |
| `0.2.x` | 上游自带 `plugin-manager` + `plugin-market`（Discover 页）+ 索引格式 1 | 与我们内置的 `dshmarket` 功能重叠 |

`dsh-app-boot` 的导出面变化最剧烈：`0.1.2` 的 23 个导出 → `0.2.1` 的 60+ 个，
`DEFAULT_PROFILE_PATCH_RELOAD`、`HARNESS_SOURCE_SECTION`、`addHarnessSourceSection`、
`assertEntriesActivated`、`assertEntriesLoaded`、`watchUserPatches`、
`healProfilesModuleFallback` 全部删除。

## 3. 逐项对照与决策

| 我们的做法 | 上游现状 | 决策 |
| --- | --- | --- |
| `profile-bootstrap.mjs` 直接改 `dsh.profile.bundles` | `writeProfileBundles` / `reconcileProfilePlugins` / `loadProfileDirectory` / `sanitizeProfile` | **换成上游 API**，旧版本保留回退分支 |
| 兼容 `healProfilesModuleFallback` | `0.1.7+` 用 `removeLinkProjections` | **按能力检测二选一**，不再假设导出存在 |
| `initProfile(dir, bundles, patchReload)` | `initProfile(dir, bundles)` | 始终传第三参（新版本忽略），兼容 `0.1.2–0.1.5` |
| 依赖 app-boot 的旧模块回退机制 | 新版本只从 profile 解析 bundle | **保留一个最小适配**：把 `dshmarket` 链到 `$DSH_HOME/profiles/node_modules` |
| 内置 `dshmarket` | 上游 `dsh-plugin-market` + `dsh-experimental-plugin-market-bundle`（Discover，默认关闭，索引格式 1） | **暂时保留 `dshmarket`**：社区索引目前不是上游格式 1，上游市场还不能直接替代；等社区提供格式 1 索引后再切 |
| 自带 pnpm / node-gyp / prebuild-install | `plugin-manager` 用 `pnpmCommand`，默认 fallback 源就是 npmmirror | 保留（离线安装、原生构建仍需要），`.npmrc` 继续写 |
| GitHub 下载加速 shim | 上游只做了 registry fallback + `git ls-remote` 检查，没有 URL 前缀改写 | **保留**（上游无替代） |
| 外层边缘代理 + 管理密码登录 | 上游只有 launch-token / cookie，面向单机 loopback，不适合 NAS 多入口 | **保留**（上游不适配），补上 token 引导 |
| 代理把 `Host`/`Origin` 改写成 loopback | 上游文档建议保留浏览器 Host + `--trusted-host`；但 Host 栅栏明确接受 loopback | 保留改写：NAS 的 IP/主机名不固定，loopback 改写是更稳的适配 |
| `healProfilesModuleFallback` 的时代补丁 | 已被上游移除 | 构建脚本继续断言补丁不存在 |
| 无 PR 校验 | 上游每天发版 | **新增 PR 运行时冒烟**，不再让人肉判断“这个 PR 能不能合” |

## 4. 本次落地的修改

### 4.1 `app/profile-bootstrap.mjs`

- 用 `appBoot.healProfilesModuleFallback ?? appBoot.removeLinkProjections` 做版本适配。
- `initProfile` 保持三参调用；`writeProfileBundles` 存在时优先使用。
- 新增 `linkRuntimeBundle("dshmarket")`：在 `$DSH_HOME/profiles/node_modules` 建立指向
  runtime 的软链。`0.1.7+` 不再把安装依赖闭包投影进 profile，第三方 bundle 因此找不到；
  这个软链只影响我们自己打包的 bundle，不碰上游的 `.dsh-module-fallback`。
- `PROFILE_TEMPLATES.web` 的结构差异（有无 `patchReload`）由现有兼容分支处理。

### 4.2 `cmd/main`

- 启动 DSH 时加 `--no-open`（NAS 上没有可用的桌面浏览器）。
- 可选 `DSH_PUBLIC_URL` → `--public-url`。
- 拒绝通配 `DSH_HOST`（上游 0.2.1+ 会直接报错）。
- 启动后从日志里抓取 `dsh web: …?token=…`，写入
  `TRIM_PKGVAR/gateway/dsh-launch-token`（0600），供边缘代理做一次性 cookie 交换。
- 把 token 文件路径传给 `proxy.js`。

### 4.3 `dsh-remote-gateway`（`@fnos/dsh-fnos-access`）

- 代理为“没有 DSH cookie 的首页 HTML 导航”自动追加 `?token=`。
- DSH 返回 401 且请求带着过期 cookie 时，先清 cookie 再回首页重试，避免死循环。
- token 只从私有文件读取，不进入访问日志。
- 已推送到 `javen-yan/dsh-remote-gateway` 的 `fix/dsh-launch-token`
  分支，`app/package.json` 固定到该提交 `e01c433`。

### 4.4 `scripts/build-runtime.sh`

- npm ≥ 11.19 时加 `--dangerously-allow-all-scripts`，恢复原生依赖安装脚本。
- `node-pty` 断言只认当前 `platform-arch` 的 `pty.node`。
- 新增运行时冒烟：初始化 profile → 启动 `dsh web --port 0` → 断言没有
  “entry did not activate” → token 交换返回 303 → 带 cookie 的首页返回 200 且包含
  `__DSH_BOOT__`。

### 4.5 CI

- 新增 `Validate Runtime`：凡是改动 `app/package*.json`、`profile-bootstrap.mjs`、
  `cmd/**`、`manifest`、`build-runtime.sh` 的 PR，都真实构建一次 runtime 并冒烟。
- `Upstream Update PR` 在创建新 PR 后关闭被取代的旧 bot PR，避免堆积 30+ 个分支。

## 5. 后续建议

1. **观察上游插件市场**：等社区索引升级到索引格式 1，或加一个生成器，把
   `dshmarket` 的注册表转成格式 1，然后切到上游 `plugin-market` + Discover，
   删除 `dshmarket` 依赖。这样可以彻底消除 dshmarket peer 范围跟不上 DSH 版本导致的
   ERESOLVE。
2. **兼容性准入**：`0.2.1-alpha.3` 起第三方插件可能被拒绝。不要自动写
   `compatibility.json` 豁免；让 PR 校验失败并提示用户升级插件，才是安全做法。
3. **可选 bundle**：上游把定时任务、会话搜索、Ralph、终端等改成可选 bundle。若产品上
   想默认开启，写入 `dsh.profile.bundles`（走 `writeProfileBundles`）即可，不要再复制
   upstream 的 patch 行。
4. **路径模式**：如果以后要恢复前缀部署，用上游的 `--public-url` + 代理剥离前缀，
   不要再回到改写 boot URL 的做法。

## 6. 第三方客户端插件不兼容的典型症状

`@linxin666/dsh-client-ui-aionui-panel`（截至 0.3.6）是典型例子：

- 它 `require("@deepseek-ai/dsh-client-runtime/client")`。该包只发布到 `0.1.1-rc.2`，
  DSH 0.1.2+ 已把它拆成 `@deepseek-ai/dsh-client-store` / `dsh-client-ui-slots` 等，
  0.2.1 的前端静态模块表里没有它。
- 它的客户端插件还 `inject(["sessions", "locale", "settingsScope"])`，而 0.2.1 既没有
  `settingsScope` 也没有 `webUiSettings`。
- 它的 `dsh.engines.dsh` 写成 `>=0.1.1-rc.1`，上游兼容性检查因此放行，问题只在浏览器
  boot 时才暴露（`web boot: N entry did not activate`）。

结论：这类插件需要作者按新版客户端服务迁移，封装层无法也不应该替它做兼容。
临时处理是从 profile 中移除该插件（见 README 的故障排查）。

## 7. 旧版本遗留的内置插件副本

`382b830` 之前，应用通过 `dsh plugin --profile web add dshmarket` 把插件市场装进
`profiles/web/node_modules`。之后改成 runtime 内置，但旧的 profile 副本不会被自动删除。
Node 解析 bundle 代码时优先用 profile 副本，而 bundle patch 从 runtime 读取，于是会
出现“旧代码 + 新 patch”的版本错配。

`profile-bootstrap.mjs` 现在会在启动时删除这些遗留副本：

- `profiles/web/node_modules/dshmarket`
- `profiles/web/node_modules/@fnos/deepseek-harness-gateway`
- `profiles/web/node_modules/@fnos/dsh-fnos-access`

然后把 runtime 的 `dshmarket` 以软链形式放到 `$DSH_HOME/profiles/node_modules`。
用户自己安装的其他插件不受影响。


## 8. 运行时树必须是被 npm 提升（hoisted）的

`0.2.1-rc.2` 在我们的依赖组合下会解析出**嵌套**的模块树：

```
node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-persona
node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-system-prompt
```

顶层没有 `dsh-system-prompt` 时，DSH 会装载两份 prompt registry，于是新增会话
失败：

```
agent-preset/invalid: persona (@deepseek-ai/dsh-persona): prompt section
"deployment:persona-prefix" is already registered
```

已在无任何 fnOS 插件、干净 profile 的情况下复现。`0.2.1-rc.1` 会正常提升
（顶层 304 个 `@deepseek-ai/*` 包），会话创建正常。

同样的问题也会出现在 **lockfile 与构建镜像 npm 版本不一致**时：macOS 的
npm 10 生成的 `app/package-lock.json`，在 `node:24-bookworm`（npm 11）里
`npm ci` 出来的树只有 128 个顶层包，症状完全相同。

因此：

- `app/package-lock.json` 必须在构建镜像内用 Node 24 的 npm 生成；
- `scripts/build-runtime.sh` 会断言 `dsh-system-prompt` / `dsh-persona` 位于顶层，
  否则构建失败；
- `scripts/dsh-version-policy.js` 记录已知会嵌套的版本（当前为 `0.2.1-rc.2`），
  自动更新机器人不会再为它们开 PR。
