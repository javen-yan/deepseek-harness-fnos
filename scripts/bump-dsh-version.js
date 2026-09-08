#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const dshVersion = process.argv[2];
const dshmarketVersion = process.argv[3];

if (!dshVersion || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(dshVersion)) {
  console.error("Usage: node scripts/bump-dsh-version.js <dsh-version> [dshmarket-version] [app-revision]");
  console.error("Example: node scripts/bump-dsh-version.js 0.1.2-rc.1 1.45.0");
  process.exit(1);
}

if (dshmarketVersion && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(dshmarketVersion)) {
  console.error("dshmarket version must be a valid npm package version.");
  process.exit(1);
}

const packageJsonPath = path.join(rootDir, "app", "package.json");
const packageLockPath = path.join(rootDir, "app", "package-lock.json");
const manifestPath = path.join(rootDir, "manifest");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const currentAppVersion = packageJson.version || "";
const currentVersionMatch = currentAppVersion.match(/^(.*)-(\d+)$/);
const defaultAppRevision = currentVersionMatch && currentVersionMatch[1] === dshVersion
  ? String(Number(currentVersionMatch[2]) + 1)
  : "1";
const appRevision = process.argv[4] || defaultAppRevision;
if (!/^[1-9]\d*$/.test(appRevision)) {
  console.error("App revision must be a positive integer.");
  process.exit(1);
}
const appVersion = `${dshVersion}-${appRevision}`;

packageJson.version = appVersion;
packageJson.dependencies = packageJson.dependencies || {};
packageJson.dependencies["@deepseek-ai/dsh"] = dshVersion;
if (dshmarketVersion) {
  packageJson.dependencies.dshmarket = dshmarketVersion;
}
fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

if (fs.existsSync(packageLockPath)) {
  const packageLock = JSON.parse(fs.readFileSync(packageLockPath, "utf8"));
  packageLock.version = appVersion;
  packageLock.packages = packageLock.packages || {};
  packageLock.packages[""] = packageLock.packages[""] || {};
  packageLock.packages[""].version = appVersion;
  packageLock.packages[""].dependencies = packageLock.packages[""].dependencies || {};
  packageLock.packages[""].dependencies["@deepseek-ai/dsh"] = dshVersion;
  if (dshmarketVersion) {
    packageLock.packages[""].dependencies.dshmarket = dshmarketVersion;
  }
  fs.writeFileSync(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`);
}

const changelog = dshmarketVersion
  ? `Update DeepSeek Harness to ${dshVersion} and dshmarket to ${dshmarketVersion}.`
  : `Update DeepSeek Harness to ${dshVersion}.`;
const manifest = fs.readFileSync(manifestPath, "utf8")
  .replace(/^version=.*$/m, `version=${appVersion}`)
  .replace(/^changelog=.*$/m, `changelog=${changelog}`);
fs.writeFileSync(manifestPath, manifest);

console.log(`Updated @deepseek-ai/dsh to ${dshVersion}`);
if (dshmarketVersion) {
  console.log(`Updated dshmarket to ${dshmarketVersion}`);
}
console.log(`Updated fnOS app version to ${appVersion}`);
