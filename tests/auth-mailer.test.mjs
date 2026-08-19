import assert from "node:assert/strict";
import test from "node:test";
import {
  MailDeliveryError,
  createMagicLinkMailer,
  createPostmarkMailer,
  createResendMailer,
} from "../infra/email/magic-link-mailer.ts";
import { createMagicLinkMessage } from "../infra/email/magic-link-message.ts";

const API_KEY = "re_live_secret_key_value";
const SERVER_TOKEN = "postmark-secret-server-token";
const expiresAt = new Date("2026-08-15T12:10:00.000Z");
const now = () => new Date("2026-08-15T12:00:00.000Z");

function recordingFetch(response = { ok: true, status: 200 }) {
  const calls = [];
  const send = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: response.ok, status: response.status };
  };
  send.calls = calls;
  return send;
}

const delivery = {
  to: "player@example.com",
  link: "https://riftory.example/giris/dogrula?token=abc",
  purpose: "signin",
  expiresAt,
};

test("builds a one-time message with an escaped link and a plain-text fallback", () => {
  const message = createMagicLinkMessage({
    link: "https://riftory.example/giris/dogrula?token=a&next=b",
    purpose: "verify_email",
    expiresAt,
    now: now(),
  });

  assert.equal(message.subject, "Riftory hesabını doğrula");
  assert.ok(message.text.includes("https://riftory.example/giris/dogrula?token=a&next=b"));
  assert.ok(message.text.includes("10 dakika"));
  assert.ok(message.html.includes("token=a&amp;next=b"));
  assert.ok(!message.html.includes("token=a&next=b"));
});

test("refuses to send a login link over a plaintext origin", () => {
  assert.throws(
    () => createMagicLinkMessage({ link: "http://riftory.example/giris/dogrula", purpose: "signin", expiresAt }),
    TypeError,
  );
});

test("sends the Resend payload without leaking the credential into the message body", async () => {
  const send = recordingFetch();
  const mailer = createResendMailer({ apiKey: API_KEY, from: "Riftory <hello@riftory.example>", fetch: send, now });
  await mailer.sendMagicLink(delivery);

  const [call] = send.calls;
  assert.equal(call.url, "https://api.resend.com/emails");
  assert.equal(call.init.headers.authorization, `Bearer ${API_KEY}`);
  assert.deepEqual(call.body.to, ["player@example.com"]);
  assert.equal(call.body.from, "Riftory <hello@riftory.example>");
  assert.equal(call.body.subject, "Riftory giriş bağlantın");
  assert.ok(call.body.text.includes(delivery.link));
  assert.ok(!JSON.stringify(call.body).includes(API_KEY));
});

test("sends the Postmark payload with tracking disabled", async () => {
  const send = recordingFetch();
  const mailer = createPostmarkMailer({ serverToken: SERVER_TOKEN, from: "hello@riftory.example", fetch: send, now });
  await mailer.sendMagicLink({ ...delivery, purpose: "verify_email" });

  const [call] = send.calls;
  assert.equal(call.url, "https://api.postmarkapp.com/email");
  assert.equal(call.init.headers["x-postmark-server-token"], SERVER_TOKEN);
  assert.equal(call.body.To, "player@example.com");
  assert.equal(call.body.TrackOpens, false);
  assert.equal(call.body.TrackLinks, "None");
});

test("reports provider failures without exposing credentials or recipients", async () => {
  const rejected = createResendMailer({
    apiKey: API_KEY,
    from: "hello@riftory.example",
    fetch: recordingFetch({ ok: false, status: 422 }),
    now,
  });
  await assert.rejects(
    () => rejected.sendMagicLink(delivery),
    (error) => {
      assert.ok(error instanceof MailDeliveryError);
      assert.equal(error.status, 422);
      assert.doesNotMatch(error.message, /re_live_secret_key_value|player@example\.com/);
      return true;
    },
  );

  const offline = createResendMailer({
    apiKey: API_KEY,
    from: "hello@riftory.example",
    fetch: async () => { throw new Error("socket closed"); },
    now,
  });
  await assert.rejects(
    () => offline.sendMagicLink(delivery),
    (error) => error instanceof MailDeliveryError && error.status === null,
  );
});

test("rejects sender addresses that could inject mail headers", () => {
  assert.throws(
    () => createResendMailer({ apiKey: API_KEY, from: "hello@riftory.example\nBcc: evil@example.com" }),
    TypeError,
  );
  assert.throws(() => createResendMailer({ apiKey: API_KEY, from: "riftory" }), TypeError);
});

test("selects a provider from the environment and stays null when none is configured", () => {
  const from = "hello@riftory.example";
  assert.notEqual(createMagicLinkMailer({ EMAIL_FROM: from, RESEND_API_KEY: API_KEY }), null);
  assert.notEqual(createMagicLinkMailer({ EMAIL_FROM: from, POSTMARK_SERVER_TOKEN: SERVER_TOKEN }), null);
  assert.equal(createMagicLinkMailer({ EMAIL_FROM: from }), null);
  assert.equal(createMagicLinkMailer({ RESEND_API_KEY: API_KEY }), null);
});
