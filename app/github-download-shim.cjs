/* eslint-disable no-console */
"use strict";

const http = require("node:http");
const https = require("node:https");

const TARGET_HOSTS = new Set([
  "github.com",
  "www.github.com",
  "codeload.github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "api.github.com",
]);

const proxyPrefix = normalizePrefix(process.env.FNOS_GITHUB_DOWNLOAD_PROXY || process.env.GITHUB_DOWNLOAD_PROXY || "");

function normalizePrefix(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === "direct" || trimmed === "disabled" || trimmed === "off") return "";
  const first = trimmed.split(/[,\s]+/).find(Boolean) || "";
  if (!/^https?:\/\//i.test(first)) return "";
  return first.endsWith("/") ? first : `${first}/`;
}

function shouldRewrite(url) {
  return proxyPrefix && url && TARGET_HOSTS.has(url.hostname);
}

function rewriteUrl(url) {
  if (!shouldRewrite(url)) return url;
  const rewritten = new URL(`${proxyPrefix}${url.href}`);
  if (process.env.FNOS_GITHUB_DOWNLOAD_LOG !== "0") {
    console.error(`[fnos-github-download-shim] rewrite ${url.href} -> ${rewritten.href}`);
  }
  return rewritten;
}

function optionsToUrl(options) {
  if (!options || typeof options !== "object") return null;
  const protocol = options.protocol || "https:";
  const hostname = options.hostname || options.host;
  if (!hostname) return null;
  const port = options.port ? `:${options.port}` : "";
  const path = options.path || options.pathname || "/";
  return new URL(`${protocol}//${hostname}${port}${path}`);
}

function rewriteRequestArgs(args) {
  const next = [...args];

  if (typeof next[0] === "string" || next[0] instanceof URL) {
    const rewritten = rewriteUrl(new URL(next[0]));
    if (rewritten.href !== new URL(next[0]).href) {
      next[0] = rewritten;
      if (next[1] && typeof next[1] === "object" && !(next[1] instanceof URL)) {
        next[1] = { ...next[1], headers: { ...(next[1].headers || {}) } };
      }
    }
    return next;
  }

  if (next[0] && typeof next[0] === "object") {
    const original = optionsToUrl(next[0]);
    if (!original) return next;
    const rewritten = rewriteUrl(original);
    if (rewritten.href === original.href) return next;
    next[0] = {
      ...next[0],
      protocol: rewritten.protocol,
      hostname: rewritten.hostname,
      host: rewritten.host,
      port: rewritten.port,
      path: `${rewritten.pathname}${rewritten.search}`,
      href: rewritten.href,
    };
  }

  return next;
}

function patchModule(mod) {
  const request = mod.request;
  const get = mod.get;
  mod.request = function patchedRequest(...args) {
    return request.apply(this, rewriteRequestArgs(args));
  };
  mod.get = function patchedGet(...args) {
    return get.apply(this, rewriteRequestArgs(args));
  };
}

patchModule(http);
patchModule(https);

if (typeof globalThis.fetch === "function") {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function patchedFetch(input, init) {
    if (typeof input === "string" || input instanceof URL) {
      return originalFetch.call(this, rewriteUrl(new URL(input)), init);
    }
    if (input && typeof input.url === "string") {
      const rewritten = rewriteUrl(new URL(input.url));
      if (rewritten.href !== input.url) {
        return originalFetch.call(this, new Request(rewritten, input), init);
      }
    }
    return originalFetch.call(this, input, init);
  };
}
