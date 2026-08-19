export type MagicLinkPurpose = "signin" | "verify_email";

export type MagicLinkMessageInput = {
  link: string;
  purpose: MagicLinkPurpose;
  expiresAt: Date;
  now?: Date;
};

export type MagicLinkMessage = {
  subject: string;
  text: string;
  html: string;
};

const MINUTE_MS = 60_000;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function assertDeliverableLink(link: string) {
  const url = new URL(link);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new TypeError("Giriş bağlantısı HTTPS olmalıdır.");
  }
  return url.href;
}

function remainingMinutes(expiresAt: Date, now: Date) {
  return Math.max(1, Math.round((expiresAt.getTime() - now.getTime()) / MINUTE_MS));
}

export function createMagicLinkMessage(input: MagicLinkMessageInput): MagicLinkMessage {
  const link = assertDeliverableLink(input.link);
  const minutes = remainingMinutes(input.expiresAt, input.now ?? new Date());
  const subject = input.purpose === "verify_email"
    ? "Riftory hesabını doğrula"
    : "Riftory giriş bağlantın";
  const opening = input.purpose === "verify_email"
    ? "Hesabını oluşturmak için e-posta adresini doğrula."
    : "Hesabına giriş yapmak için bu bağlantıyı kullan.";

  const text = [
    opening,
    "",
    link,
    "",
    `Bağlantı ${minutes} dakika geçerlidir ve yalnızca bir kez kullanılabilir.`,
    "Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin; hesabında değişiklik olmaz.",
    "",
    "Riftory",
  ].join("\n");

  const html = [
    '<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:16px;line-height:1.6;color:#111">',
    `<p>${escapeHtml(opening)}</p>`,
    `<p><a href="${escapeHtml(link)}" rel="noopener noreferrer">Giriş bağlantısını aç</a></p>`,
    `<p style="font-size:14px;color:#444">Bağlantı ${minutes} dakika geçerlidir ve yalnızca bir kez kullanılabilir.</p>`,
    '<p style="font-size:14px;color:#444">Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin; hesabında değişiklik olmaz.</p>',
    `<p style="font-size:13px;color:#666">Bağlantı açılmazsa bu adresi tarayıcına yapıştır:<br>${escapeHtml(link)}</p>`,
    "<p>Riftory</p>",
    "</div>",
  ].join("");

  return { subject, text, html };
}
