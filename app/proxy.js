const http = require("http");
const net = require("net");
const fs = require("fs");

const PREFIX = process.env.GATEWAY_PREFIX || "/app/deepseek_harness";
const SOCKET_PATH = process.env.SOCKET_PATH || "app.sock";
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || "127.0.0.1";
const UPSTREAM_PORT = Number(process.env.UPSTREAM_PORT || "3080");

const API_PATH = "/api";
const RESOURCE_PATHS = [
  "/assets",
  "/favicon.svg",
  "/manifest.webmanifest",
  "/plugins",
];

function stripPrefix(url) {
  if (url === PREFIX) return "/";
  if (url.startsWith(`${PREFIX}/`)) return url.slice(PREFIX.length) || "/";
  return url;
}

function rewriteLocation(value) {
  if (!value) return value;
  if (value.startsWith(PREFIX)) return value;
  if (RESOURCE_PATHS.some((path) => value === path || value.startsWith(`${path}/`))) {
    return `${PREFIX}${value}`;
  }
  return value;
}

function rewriteAbsolutePaths(text, paths) {
  for (const path of paths) {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text
      .replace(new RegExp(`(["'=])${escaped}(?=([/?#"]|'))`, "g"), `$1${PREFIX}${path}`)
      .replace(new RegExp(`url\\(${escaped.replace(/\//g, "\\/")}`, "g"), `url(${PREFIX}${path}`);
  }
  return text;
}

function gatewayShim() {
  const prefix = JSON.stringify(PREFIX);
  const apiPath = JSON.stringify(API_PATH);
  return `<script>(() => {
  const prefix = ${prefix};
  const apiPath = ${apiPath};
  const sameOriginApi = (url) => {
    const next = new URL(url, window.location.href);
    if (next.origin === window.location.origin && (next.pathname === apiPath || next.pathname.startsWith(apiPath + "/"))) {
      next.pathname = prefix + next.pathname;
    }
    return next;
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (input instanceof Request) {
      const next = sameOriginApi(input.url);
      return nativeFetch(new Request(next, input), init);
    }
    return nativeFetch(sameOriginApi(input), init);
  };
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = new Proxy(NativeWebSocket, {
    construct(Target, args) {
      if (args.length > 0) args[0] = sameOriginApi(args[0]).toString();
      return Reflect.construct(Target, args);
    }
  });
  window.WebSocket.prototype = NativeWebSocket.prototype;
})()</script>`;
}

function rewriteBody(contentType, body) {
  if (!contentType) return body;

  let text = body.toString("utf8");
  if (/text\/html/i.test(contentType)) {
    text = rewriteAbsolutePaths(text, RESOURCE_PATHS);
    text = text.replace(/<link\s+rel=["']manifest["'][^>]*>\s*/i, "");
    if (!text.includes("window.__DSH_GATEWAY_SHIM__")) {
      text = text.replace(
        /<head>/i,
        `<head><script>window.__DSH_GATEWAY_SHIM__=true</script>${gatewayShim()}`,
      );
    }
    return Buffer.from(text, "utf8");
  }

  if (/(json|text\/css)/i.test(contentType)) {
    return Buffer.from(rewriteAbsolutePaths(text, RESOURCE_PATHS), "utf8");
  }

  return body;
}

const server = http.createServer((req, res) => {
  const upstreamPath = stripPrefix(req.url || "/");
  const headers = { ...req.headers, host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}` };
  delete headers["accept-encoding"];

  const upstreamReq = http.request(
    {
      host: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: req.method,
      path: upstreamPath,
      headers,
    },
    (upstreamRes) => {
      const chunks = [];
      upstreamRes.on("data", (chunk) => chunks.push(chunk));
      upstreamRes.on("end", () => {
        let body = Buffer.concat(chunks);
        const responseHeaders = { ...upstreamRes.headers };
        if (responseHeaders.location) {
          responseHeaders.location = rewriteLocation(responseHeaders.location);
        }
        body = rewriteBody(String(responseHeaders["content-type"] || ""), body);
        delete responseHeaders["content-encoding"];
        responseHeaders["content-length"] = Buffer.byteLength(body);
        res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
        res.end(body);
      });
    },
  );

  upstreamReq.on("error", (error) => {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(`DeepSeek Harness upstream unavailable: ${error.message}\n`);
  });

  req.pipe(upstreamReq);
});

server.on("upgrade", (req, socket, head) => {
  const upstreamPath = stripPrefix(req.url || "/");
  const upstream = net.connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
    const headers = [
      `${req.method} ${upstreamPath} HTTP/${req.httpVersion}`,
      ...Object.entries(req.headers).map(([key, value]) => `${key}: ${value}`),
      "",
      "",
    ].join("\r\n");
    upstream.write(headers);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });

  upstream.on("error", () => socket.destroy());
});

if (fs.existsSync(SOCKET_PATH)) {
  fs.unlinkSync(SOCKET_PATH);
}

server.listen(SOCKET_PATH, () => {
  fs.chmodSync(SOCKET_PATH, 0o660);
  console.log(`gateway proxy listening on ${SOCKET_PATH}, prefix ${PREFIX}`);
});
