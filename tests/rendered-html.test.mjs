import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

const workerEnv = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const workerContext = {
  waitUntil() {},
  passThroughOnException() {},
};

test("renders development preview metadata", async () => {
  const worker = await loadWorker();

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    workerEnv,
    workerContext,
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

test("renders a descriptive Turkish home title and website structured data", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    workerEnv,
    workerContext,
  );

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Oyun Sunucusu Kiralama \| Minecraft &amp; Terraria \| Riftory<\/title>/);
  assert.match(html, /Oyun sunucunu kur/);
  assert.match(html, /"@type":"WebSite"/);
  assert.match(html, /Minecraft sunucu kiralama/);
  assert.match(html, /Terraria sunucu kiralama/);
});

test("renders the Minecraft search landing page with honest beta copy", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/minecraft-sunucu-kiralama", { headers: { accept: "text/html" } }),
    workerEnv,
    workerContext,
  );

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Minecraft Sunucu Kiralama ve Hosting \| Riftory<\/title>/);
  assert.match(html, /Minecraft sunucu kiralama/);
  assert.match(html, /Paper · Vanilla · Fabric/);
  assert.doesNotMatch(html, /Forge/);
  assert.match(html, /Ödeme ve gerçek sunucu teslimi henüz etkin değildir/);
  assert.match(html, /"@type":"BreadcrumbList"/);
  assert.match(html, /rel="canonical" href="https:\/\/oyun-sunucu\.fatihcvs55\.chatgpt\.site\/minecraft-sunucu-kiralama"/);
});

test("renders the Terraria search landing page with controlled tModLoader scope", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/terraria-sunucu-kiralama", { headers: { accept: "text/html" } }),
    workerEnv,
    workerContext,
  );

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Terraria Sunucu Kiralama ve tModLoader Hosting \| Riftory<\/title>/);
  assert.match(html, /Terraria sunucu kiralama/);
  assert.match(html, /tModLoader kontrollü beta/);
  assert.match(html, /Terraria satışı henüz açık değildir/);
});

test("serves a focused public sitemap", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/sitemap.xml"),
    workerEnv,
    workerContext,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /xml/i);
  const xml = await response.text();
  assert.match(xml, /minecraft-sunucu-kiralama/);
  assert.match(xml, /terraria-sunucu-kiralama/);
  assert.doesNotMatch(xml, /\/giris<\/loc>/);
  assert.doesNotMatch(xml, /\/hesap<\/loc>/);
});

test("serves robots directives with the sitemap location", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/robots.txt"),
    workerEnv,
    workerContext,
  );

  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /User-Agent: \*/i);
  assert.match(text, /Allow: \//i);
  assert.match(text, /Disallow: \/api\//i);
  assert.match(text, /Disallow: \/admin/i);
  assert.match(text, /Sitemap: https:\/\/oyun-sunucu\.fatihcvs55\.chatgpt\.site\/sitemap\.xml/i);
});

test("renders the admin gate as a private noindex operations page", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/admin", { headers: { accept: "text/html" } }),
    workerEnv,
    workerContext,
  );

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Operasyon Yönetim Paneli/);
  assert.match(html, /OPERASYON KONSOLU/);
  assert.match(html, /Operasyon verisi hazırlanıyor/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow"\/>/);
});

test("returns an honest 503 from the built admin endpoint without database configuration", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/admin", { headers: { accept: "application/json" } }),
    workerEnv,
    workerContext,
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    code: "ADMIN_NOT_CONFIGURED",
    message: "Yönetim paneli henüz etkin değil.",
  });
});

test("preselects a game from a safe configurator query on the first render", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/kurulum?game=terraria&plan=starter-4", {
      headers: { accept: "text/html" },
    }),
    workerEnv,
    workerContext,
  );

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /aria-pressed="true" class="selected"[^>]*>[\s\S]{0,320}Terraria/);
});

test("renders the registration form without claiming a live delivery guarantee", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/giris?mode=register&return_to=%2Fpanel", {
      headers: { accept: "text/html" },
    }),
    workerEnv,
    workerContext,
  );

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Hesabını oluşturalım/);
  assert.match(html, /CANLI TESLİMAT ORTAMA BAĞLI/);
  assert.match(html, /Canlı teslimat yayın ortamına bağlıdır/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow"\/>/);
});

test("renders the magic-link confirmation step behind an explicit user action", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request(`http://localhost/giris/dogrula?token=${"a".repeat(43)}`, {
      headers: { accept: "text/html" },
    }),
    workerEnv,
    workerContext,
  );

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Girişini tamamla/);
  assert.match(html, /tek kullanımlıktır/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow"\/>/);
});

test("renders an honest signed-out account center", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/hesap", {
      headers: { accept: "text/html" },
    }),
    workerEnv,
    workerContext,
  );

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Hesap ve Güvenlik Merkezi/);
  assert.match(html, /Henüz giriş yapılmadı/);
  assert.match(html, /sahte sunucu verisi göstermiyoruz/);
  assert.match(html, /4(?:<!-- -->)? \/ (?:<!-- -->)?6(?:<!-- -->)? kapı hazır/);
  assert.match(html, /PostgreSQL deposu/);
  assert.match(html, /Canlı Railway bağlantısı/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow"\/>/);
});

test("serves a cacheless auth readiness response without secret values", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/auth/status"),
    workerEnv,
    workerContext,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const body = await response.text();
  assert.match(body, /"live":false/);
  assert.match(body, /"postgresAdapter":false/);
  assert.doesNotMatch(body, /postgresql:\/\/|RESEND_API_KEY":"/);
});

test("returns an honest 503 from the built email-auth endpoint", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/auth/email/start", {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ mode: "signin", email: "player@example.com" }),
    }),
    workerEnv,
    workerContext,
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    code: "AUTH_NOT_CONFIGURED",
    message: "Canlı e-posta girişi henüz etkin değil.",
  });
});
