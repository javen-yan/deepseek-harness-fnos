const http = require("http");
const net = require("net");
const fs = require("fs");

const PREFIX = process.env.GATEWAY_PREFIX || "/app/deepseek_harness";
const SOCKET_PATH = process.env.SOCKET_PATH || "app.sock";
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || "127.0.0.1";
const UPSTREAM_PORT = Number(process.env.UPSTREAM_PORT || "3080");

const ABSOLUTE_PATHS = [
  "/api",
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
  if (ABSOLUTE_PATHS.some((path) => value === path || value.startsWith(`${path}/`))) {
    return `${PREFIX}${value}`;
  }
  return value;
}

function rewriteBody(contentType, body) {
  if (!contentType || !/(text\/html|javascript|json|text\/css)/i.test(contentType)) {
    return body;
  }

  let text = body.toString("utf8");
  for (const path of ABSOLUTE_PATHS) {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text
      .replace(new RegExp(`(["'=])${escaped}(?=([/?#"]|'))`, "g"), `$1${PREFIX}${path}`)
      .replace(new RegExp(`url\\(${escaped.replace(/\//g, "\\/")}`, "g"), `url(${PREFIX}${path}`);
  }
  return Buffer.from(text, "utf8");
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
