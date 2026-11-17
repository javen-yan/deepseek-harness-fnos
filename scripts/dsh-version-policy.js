"use strict";

// Versions that install and boot but fail at runtime. Each entry needs a
// one-line reason; the updater refuses them so the bot cannot open a PR for a
// runtime we already know is broken.
const KNOWN_BAD_DSH_VERSIONS = {
  // Installs a nested tree (dsh-persona/dsh-system-prompt below @deepseek-ai/dsh)
  // instead of the hoisted one, even with a lockfile resolved by the build
  // image's npm. DSH then loads two prompt registries and every new Session
  // fails with `agent-preset/invalid: persona ... "deployment:persona-prefix"
  // is already registered`. Reproduced with no fnOS plugins and on a clean
  // profile; 0.2.1-rc.1 hoists correctly and works.
  "0.2.1-rc.2": "nested node_modules tree breaks agent preset mounting",
};

/**
 * Explain why a version must not be packaged, if it is blocked.
 * @param {string} version - Exact @deepseek-ai/dsh version.
 * @returns {string|undefined} The blocking reason, or undefined when allowed.
 */
function blockedReason(version) {
  return Object.prototype.hasOwnProperty.call(KNOWN_BAD_DSH_VERSIONS, version)
    ? KNOWN_BAD_DSH_VERSIONS[version]
    : undefined;
}

module.exports = { KNOWN_BAD_DSH_VERSIONS, blockedReason };
