#!/usr/bin/env node
/**
 * Serves the built application as a plain Node process.
 *
 * The build emits a Workers-shaped module — `export default { fetch(request,
 * env, ctx) }` — which is a standard ES module. This adapter supplies the two
 * bindings that module expects (static assets and image transformation) and
 * bridges Node's http server to the Fetch API, so the same artifact runs on
 * Railway without a Workers runtime.
 */
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { extname, join, normalize, sep } from "node:path";
import { resolveAssetPath } from "../lib/asset-path.ts";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const CLIENT_ROOT = fileURLToPath(new URL("../dist/client/", import.meta.url));
const SERVER_ENTRY = new URL("../dist/server/index.js", import.meta.url);

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

/** Fingerprinted build output may be cached forever; everything else must not be. */
function cacheControlFor(pathname) {
  return pathname.startsWith("/assets/")
    ? "public, max-age=31536000, immutable"
    : "public, max-age=0, must-revalidate";
}

const ASSET_RESOLVER = { root: CLIENT_ROOT, separator: sep, join, normalize };

/** Returns the built file for a path, or null when there is none. */
async function readStaticAsset(pathname) {
  const filePath = resolveAssetPath(pathname, ASSET_RESOLVER);
  if (!filePath) return null;

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return null;

    return new Response(Readable.toWeb(createReadStream(filePath)), {
      headers: {
        "Content-Type": CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream",
        "Content-Length": String(info.size),
        "Cache-Control": cacheControlFor(pathname),
      },
    });
  } catch {
    return null;
  }
}

const assets = {
  async fetch(input) {
    const url = new URL(typeof input === "string" ? input : input.url);
    return await readStaticAsset(url.pathname) ?? new Response("Not found", { status: 404 });
  },
};

/**
 * Cloudflare Images is not available off Workers.
 *
 * Rather than fail the request, the original bytes are returned unchanged: the
 * image is correct, merely unoptimised. The response records that so a slow
 * page is traced to this decision instead of looking like a bug.
 */
const images = {
  input(stream) {
    return {
      transform() {
        return {
          async output() {
            return {
              response: () => new Response(stream, {
                headers: { "X-Riftory-Image": "passthrough" },
              }),
            };
          },
        };
      },
    };
  },
};

function toFetchRequest(nodeRequest) {
  const host = nodeRequest.headers.host ?? `${HOST}:${PORT}`;
  const protocol = nodeRequest.headers["x-forwarded-proto"]?.split(",")[0]?.trim() || "http";
  const url = new URL(nodeRequest.url ?? "/", `${protocol}://${host}`);

  const hasBody = nodeRequest.method !== "GET" && nodeRequest.method !== "HEAD";
  return new Request(url, {
    method: nodeRequest.method,
    headers: nodeRequest.headers,
    body: hasBody ? Readable.toWeb(nodeRequest) : undefined,
    duplex: hasBody ? "half" : undefined,
  });
}

/**
 * Baseline security headers for every response.
 *
 * Deliberately not a full `script-src` policy: the framework emits inline
 * hydration scripts and font styles, so a strict script policy needs per-request
 * nonces and would break the page today. These four directives cost nothing and
 * close clickjacking, MIME sniffing, base-tag injection and plugin embedding.
 */
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
};

function applySecurityHeaders(headers, isHttps) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!(name.toLowerCase() in headers)) headers[name] = value;
  }
  // Only meaningful over TLS, and sending it on plain HTTP local runs would
  // pin a developer's browser to https for localhost.
  if (isHttps) headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  return headers;
}

async function writeResponse(response, nodeResponse, isHttps = false) {
  // getSetCookie keeps multiple Set-Cookie headers separate; joining them would
  // merge two cookies into one malformed header.
  const headers = Object.fromEntries(
    [...response.headers].filter(([name]) => name.toLowerCase() !== "set-cookie"),
  );
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) headers["set-cookie"] = cookies;

  nodeResponse.writeHead(response.status, applySecurityHeaders(headers, isHttps));
  if (!response.body) {
    nodeResponse.end();
    return;
  }

  for await (const chunk of response.body) nodeResponse.write(chunk);
  nodeResponse.end();
}

const { default: worker } = await import(SERVER_ENTRY.href);
const environment = { ...process.env, ASSETS: assets, IMAGES: images };
const pending = new Set();
const context = {
  waitUntil(promise) {
    pending.add(promise);
    promise.finally(() => pending.delete(promise)).catch(() => {});
  },
  passThroughOnException() {},
};

const server = createServer(async (nodeRequest, nodeResponse) => {
  try {
    const request = toFetchRequest(nodeRequest);
    const isHttps = new URL(request.url).protocol === "https:";

    // Cloudflare serves existing build output before the worker ever runs, so
    // the worker's router never sees `/assets/*`. Matching that order here
    // keeps one artifact behaving the same on both runtimes.
    if (request.method === "GET" || request.method === "HEAD") {
      const asset = await readStaticAsset(new URL(request.url).pathname);
      if (asset) {
        await writeResponse(asset, nodeResponse, isHttps);
        return;
      }
    }

    const response = await worker.fetch(request, environment, context);
    await writeResponse(response, nodeResponse, isHttps);
  } catch (error) {
    console.error("[riftory] istek işlenemedi", error);
    if (!nodeResponse.headersSent) nodeResponse.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    nodeResponse.end("İstek şu anda tamamlanamadı.");
  }
});

// Railway replaces instances by sending SIGTERM; refusing new connections while
// letting in-flight requests finish avoids dropping a user's sign-in mid-flow.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`[riftory] ${signal} alındı, bağlantılar kapatılıyor`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}

server.listen(PORT, HOST, () => {
  console.log(`[riftory] ${HOST}:${PORT} dinleniyor`);
});
