#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const dshVersion = process.argv[2];

if (!dshVersion || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(dshVersion)) {
  console.error("Usage: node scripts/bump-dsh-version.js <dsh-version>");
  console.error("Example: node scripts/bump-dsh-version.js 0.1.0-rc.7");
  process.exit(1);
}

const appRevision = process.argv[3] || "1";
if (!/^[1-9]\d*$/.test(appRevision)) {
  console.error("App revision must be a positive integer.");
  process.exit(1);
}
const appVersion = `${dshVersion}-${appRevision}`;
const packageJsonPath = path.join(rootDir, "app", "package.json");
const packageLockPath = path.join(rootDir, "app", "package-lock.json");
const manifestPath = path.join(rootDir, "manifest");

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
packageJson.version = appVersion;
packageJson.dependencies = packageJson.dependencies || {};
packageJson.dependencies["@deepseek-ai/dsh"] = dshVersion;
fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

if (fs.existsSync(packageLockPath)) {
  const packageLock = JSON.parse(fs.readFileSync(packageLockPath, "utf8"));
  packageLock.version = appVersion;
  packageLock.packages = packageLock.packages || {};
  packageLock.packages[""] = packageLock.packages[""] || {};
  packageLock.packages[""].version = appVersion;
  packageLock.packages[""].dependencies = packageLock.packages[""].dependencies || {};
  packageLock.packages[""].dependencies["@deepseek-ai/dsh"] = dshVersion;
  fs.writeFileSync(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`);
}

const manifest = fs.readFileSync(manifestPath, "utf8")
  .replace(/^version=.*$/m, `version=${appVersion}`)
  .replace(/^changelog=.*$/m, `changelog=Update DeepSeek Harness to ${dshVersion}.`);
fs.writeFileSync(manifestPath, manifest);

console.log(`Updated @deepseek-ai/dsh to ${dshVersion}`);
console.log(`Updated fnOS app version to ${appVersion}`);
