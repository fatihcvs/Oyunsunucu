import assert from "node:assert/strict";
import test from "node:test";
import {
  CURRENT_CONSENT_VERSION,
  createRegistrationIntent,
  isSafeReturnPath,
  isValidDisplayName,
  isValidEmail,
  normalizeDisplayName,
  normalizeEmail,
  resolveAuthRequest,
} from "../lib/auth-contracts.ts";

test("normalizes identity input before persistence", () => {
  assert.equal(normalizeEmail("  Player@Example.COM "), "player@example.com");
  assert.equal(normalizeDisplayName("  Fatih   Oyuncu  "), "Fatih Oyuncu");
  assert.equal(isValidEmail("player@example.com"), true);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidDisplayName("F"), false);
});

test("accepts only same-origin relative return paths", () => {
  assert.equal(isSafeReturnPath("/panel?tab=backups"), true);
  assert.equal(isSafeReturnPath("https://evil.example/panel"), false);
  assert.equal(isSafeReturnPath("//evil.example/panel"), false);
  assert.equal(isSafeReturnPath("/\\evil.example"), false);
  assert.equal(isSafeReturnPath("/%2f%2fevil.example/panel"), false);
  assert.equal(isSafeReturnPath("/%5c%5cevil.example/panel"), false);
  assert.deepEqual(resolveAuthRequest("unknown", "https://evil.example"), { mode: "signin", returnTo: "/panel" });
});

test("creates a versioned registration intent only for valid input", () => {
  const intent = createRegistrationIntent({
    displayName: "  Fatih   Oyuncu ",
    email: " FATIH@EXAMPLE.COM ",
    returnTo: "/panel",
  });

  assert.deepEqual(intent, {
    displayName: "Fatih Oyuncu",
    email: "fatih@example.com",
    consentVersion: CURRENT_CONSENT_VERSION,
    returnTo: "/panel",
  });
  assert.equal(createRegistrationIntent({ displayName: "F", email: "bad", returnTo: "/panel" }), null);
});
