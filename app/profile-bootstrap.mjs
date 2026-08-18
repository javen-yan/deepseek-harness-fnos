#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const runtimeDir = process.env.RUNTIME_DIR;
const dshHome = process.env.DSH_HOME;
const logFile = process.env.PROFILE_BOOTSTRAP_LOGFILE;
const buildPolicy = process.env.DSH_PLUGIN_BUILD_POLICY || "allow-all";
const npmRegistry = process.env.NPM_CONFIG_REGISTRY || process.env.npm_config_registry || "https://registry.npmmirror.com";
const githubDownloadProxy = process.env.FNOS_GITHUB_DOWNLOAD_PROXY || process.env.GITHUB_DOWNLOAD_PROXY || "";
const githubDownloadShim = process.env.FNOS_GITHUB_DOWNLOAD_SHIM || "";

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  if (logFile) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line);
  } else {
    process.stderr.write(line);
  }
}

function fail(message) {
  log(`ERROR ${message}`);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function ensureExecutableWrapper(file, nodeBin, targetBin, options = {}) {
  const shimBlock = options.githubDownloadShim
    ? `if [ -n "\${FNOS_GITHUB_DOWNLOAD_PROXY:-}" ] && [ -f "${options.githubDownloadShim}" ]; then
  if [ -n "\${NODE_OPTIONS:-}" ]; then
    export NODE_OPTIONS="--require=${options.githubDownloadShim} $NODE_OPTIONS"
  else
    export NODE_OPTIONS="--require=${options.githubDownloadShim}"
  fi
fi
`
    : "";
  const content = `#!/bin/sh\n${shimBlock}exec "${nodeBin}" "${targetBin}" "$@"\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) {
    fs.writeFileSync(file, content, { mode: 0o755 });
    fs.chmodSync(file, 0o755);
    log(`updated wrapper ${file}`);
  }
}

function normalizeWorkspaceYaml(yaml, yamlText) {
  const current = yamlText.trim()
    ? yaml.load(yamlText) || {}
    : {};
  if (typeof current !== "object" || Array.isArray(current)) {
    throw new Error("pnpm-workspace.yaml must contain a mapping");
  }

  const next = { ...current };
  if (!Array.isArray(next.packages)) {
    next.packages = ["."];
  } else if (!next.packages.includes(".")) {
    next.packages = [".", ...next.packages];
  }
  next.nodeLinker = "hoisted";
  next.autoInstallPeers = false;

  if (buildPolicy === "allow-all") {
    next.dangerouslyAllowAllBuilds = true;
  } else if (Object.prototype.hasOwnProperty.call(next, "dangerouslyAllowAllBuilds")) {
    delete next.dangerouslyAllowAllBuilds;
  }

  return yaml.dump(next, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
}

if (!runtimeDir) fail("RUNTIME_DIR is not set.");
if (!dshHome) fail("DSH_HOME is not set.");

const runtimePackage = path.join(runtimeDir, "package.json");
if (!fs.existsSync(runtimePackage)) fail(`Runtime package.json is missing: ${runtimePackage}`);

const runtimeRequire = createRequire(runtimePackage);
const nodeBin = process.env.NODE_BIN || process.execPath;
const binDir = process.env.DSH_TOOL_BIN_DIR;
const dshBin = path.join(runtimeDir, "node_modules", ".bin", "dsh");
const pnpmBin = path.join(runtimeDir, "node_modules", "pnpm", "bin", "pnpm.mjs");
const dshmarketPatch = path.join(runtimeDir, "node_modules", "dshmarket", "cordis.patch.yml");

for (const [label, file] of [
  ["dsh", dshBin],
  ["pnpm", pnpmBin],
  ["dshmarket", dshmarketPatch],
]) {
  if (!fs.existsSync(file)) fail(`Runtime is missing ${label}: ${file}`);
}

if (binDir) {
  ensureExecutableWrapper(path.join(binDir, "pnpm"), nodeBin, pnpmBin, { githubDownloadShim });
  ensureExecutableWrapper(path.join(binDir, "dsh"), nodeBin, dshBin);
}

const appBootUrl = pathToFileURL(runtimeRequire.resolve("@deepseek-ai/dsh-app-boot")).href;
const {
  PROFILE_TEMPLATES,
  healProfilesModuleFallback,
  initProfile,
  readProfileManifest,
  resolveProfileDir,
  writeProfileManifest,
} = await import(appBootUrl);

const yaml = runtimeRequire("js-yaml");
healProfilesModuleFallback(runtimePackage, dshHome);
const profileDir = resolveProfileDir("web", dshHome);
initProfile(profileDir, PROFILE_TEMPLATES.web);

const manifestBefore = readProfileManifest("deepseek-harness-fnos", profileDir);
const manifest = structuredClone(manifestBefore);
manifest.dependencies ||= {};
delete manifest.dependencies.dshmarket;
delete manifest.dependencies["@fnos/deepseek-harness-gateway"];
delete manifest.dependencies["@fnos/dsh-fnos-access"];

manifest.dsh ||= {};
manifest.dsh.profile ||= {};
const bundles = Array.isArray(manifest.dsh.profile.bundles)
  ? manifest.dsh.profile.bundles
  : [...PROFILE_TEMPLATES.web];
manifest.dsh.profile.bundles = [
  ...bundles.filter((name) => (
    name !== "dshmarket"
    && name !== "@fnos/deepseek-harness-gateway"
    && name !== "@fnos/dsh-fnos-access"
  )),
  "dshmarket",
];

if (!sameJson(manifestBefore, manifest)) {
  writeProfileManifest(profileDir, manifest);
  log(`updated web profile manifest ${path.join(profileDir, "package.json")}`);
}

const workspaceFile = path.join(profileDir, "pnpm-workspace.yaml");
const workspaceBefore = fs.existsSync(workspaceFile)
  ? fs.readFileSync(workspaceFile, "utf8")
  : "";
const workspaceAfter = normalizeWorkspaceYaml(yaml, workspaceBefore);
if (workspaceBefore !== workspaceAfter) {
  fs.writeFileSync(workspaceFile, workspaceAfter);
  log(`updated pnpm workspace settings ${workspaceFile}`);
}

const npmrcFile = path.join(profileDir, ".npmrc");
const npmrcLines = [`registry=${npmRegistry}`];
if (process.env.npm_config_proxy || process.env.HTTP_PROXY || process.env.http_proxy) {
  npmrcLines.push(`proxy=${process.env.npm_config_proxy || process.env.HTTP_PROXY || process.env.http_proxy}`);
}
if (process.env.npm_config_https_proxy || process.env.HTTPS_PROXY || process.env.https_proxy) {
  npmrcLines.push(`https-proxy=${process.env.npm_config_https_proxy || process.env.HTTPS_PROXY || process.env.https_proxy}`);
}
if (process.env.npm_config_noproxy || process.env.NO_PROXY || process.env.no_proxy) {
  npmrcLines.push(`noproxy=${process.env.npm_config_noproxy || process.env.NO_PROXY || process.env.no_proxy}`);
}
npmrcLines.push("fetch-retries=3");
npmrcLines.push("fetch-retry-mintimeout=10000");
npmrcLines.push("fetch-retry-maxtimeout=60000");
if (githubDownloadProxy) {
  npmrcLines.push(`# GitHub downloads are accelerated by ${githubDownloadProxy} through the private pnpm wrapper.`);
}
const npmrcContent = `${npmrcLines.join("\n")}\n`;
if (!fs.existsSync(npmrcFile) || fs.readFileSync(npmrcFile, "utf8") !== npmrcContent) {
  fs.writeFileSync(npmrcFile, npmrcContent, { mode: 0o600 });
  fs.chmodSync(npmrcFile, 0o600);
  log(`updated profile npm registry ${npmRegistry}`);
}

log(`profile bootstrap completed for ${profileDir}`);
