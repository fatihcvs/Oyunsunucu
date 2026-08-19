import type { MagicLinkMailer } from "../../lib/auth-service.ts";
import { createMagicLinkMessage, type MagicLinkPurpose } from "./magic-link-message.ts";

export type MailProviderName = "resend" | "postmark";

export type MailTransportOptions = {
  from: string;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
};

export const MAIL_REQUEST_TIMEOUT_MS = 10_000;

/** Carries only provider identity and transport status; never credentials or recipients. */
export class MailDeliveryError extends Error {
  readonly provider: MailProviderName;
  readonly status: number | null;

  constructor(provider: MailProviderName, status: number | null) {
    super(`${provider} sağlayıcısı giriş bağlantısını teslim edemedi.`);
    this.name = "MailDeliveryError";
    this.provider = provider;
    this.status = status;
  }
}

type DeliveryRequest = {
  to: string;
  link: string;
  purpose: MagicLinkPurpose;
  expiresAt: Date;
};

function hasHeaderInjectionRisk(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

/** Rejects header-injection characters; `Riftory <hello@example.com>` stays valid. */
function assertSenderAddress(from: string) {
  const address = from.trim();
  if (!address.includes("@") || hasHeaderInjectionRisk(address)) {
    throw new TypeError("EMAIL_FROM geçerli bir gönderen adresi olmalıdır.");
  }
  return address;
}

async function postJson(
  provider: MailProviderName,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: MailTransportOptions,
) {
  const send = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await send(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? MAIL_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new MailDeliveryError(provider, null);
  }

  if (!response.ok) throw new MailDeliveryError(provider, response.status);
}

export function createResendMailer(options: MailTransportOptions & { apiKey: string }): MagicLinkMailer {
  const from = assertSenderAddress(options.from);
  return {
    async sendMagicLink(input: DeliveryRequest) {
      const message = createMagicLinkMessage({ ...input, now: options.now?.() });
      await postJson(
        "resend",
        "https://api.resend.com/emails",
        { authorization: `Bearer ${options.apiKey}` },
        {
          from,
          to: [input.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        },
        options,
      );
    },
  };
}

export function createPostmarkMailer(options: MailTransportOptions & { serverToken: string }): MagicLinkMailer {
  const from = assertSenderAddress(options.from);
  return {
    async sendMagicLink(input: DeliveryRequest) {
      const message = createMagicLinkMessage({ ...input, now: options.now?.() });
      await postJson(
        "postmark",
        "https://api.postmarkapp.com/email",
        { "x-postmark-server-token": options.serverToken, accept: "application/json" },
        {
          From: from,
          To: input.to,
          Subject: message.subject,
          TextBody: message.text,
          HtmlBody: message.html,
          MessageStream: "outbound",
          TrackOpens: false,
          TrackLinks: "None",
        },
        options,
      );
    },
  };
}

/** Returns null when no provider credential is present, so callers stay honest about readiness. */
export function createMagicLinkMailer(
  environment: Record<string, string | undefined>,
  options: Omit<MailTransportOptions, "from"> = {},
): MagicLinkMailer | null {
  const from = environment.EMAIL_FROM?.trim() ?? "";
  if (!from) return null;

  const resendApiKey = environment.RESEND_API_KEY?.trim() ?? "";
  if (resendApiKey) return createResendMailer({ ...options, from, apiKey: resendApiKey });

  const postmarkServerToken = environment.POSTMARK_SERVER_TOKEN?.trim() ?? "";
  if (postmarkServerToken) return createPostmarkMailer({ ...options, from, serverToken: postmarkServerToken });

  return null;
}
