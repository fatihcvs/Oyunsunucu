"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "../_components/icon";
import {
  CURRENT_CONSENT_VERSION,
  createRegistrationIntent,
  isValidDisplayName,
  isValidEmail,
  normalizeEmail,
  type AuthMode,
} from "@/lib/auth-contracts";
import { CONFIGURATOR_STORAGE_KEY } from "@/lib/catalog";

type SubmitState = "idle" | "pending" | "ready";

const REQUEST_ERROR_MESSAGES: Record<string, string> = {
  AUTH_NOT_CONFIGURED: "Canlı e-posta girişi henüz açık değil; adresin gönderilmedi ve kaydedilmedi.",
  AUTH_ADAPTER_NOT_BOUND: "Kimlik deposu yayın ortamında henüz bağlı değil; hesap oluşturulmadı.",
  RATE_LIMITED: "Çok fazla deneme yapıldı. Kısa bir süre sonra yeniden dene.",
  INVALID_IDENTITY: "Ad veya e-posta bilgisi geçersiz.",
};

const GENERIC_REQUEST_ERROR = "İstek şu anda tamamlanamadı. Lütfen daha sonra yeniden dene.";

export function AuthExperience({ initialMode, returnTo }: { initialMode: AuthMode; returnTo: string }) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [acceptedMessage, setAcceptedMessage] = useState("");
  const [requestError, setRequestError] = useState("");
  const [providerNotice, setProviderNotice] = useState("");
  const [draftFound, setDraftFound] = useState(false);
  const [touched, setTouched] = useState(false);
  const returnLabel = returnTo === "/hesap" ? "Hesap merkezine dön" : "Panel demosuna dön";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setDraftFound(Boolean(window.localStorage.getItem(CONFIGURATOR_STORAGE_KEY)));
      } catch {
        setDraftFound(false);
      }
      // The Discord callback sends the visitor back here when it cannot finish.
      if (new URLSearchParams(window.location.search).get("discord") === "rejected") {
        setProviderNotice("Discord girişi tamamlanamadı. Yeniden deneyebilir veya e-posta ile devam edebilirsin.");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const chooseMode = (next: AuthMode) => {
    setMode(next);
    setSubmitState("idle");
    setProviderNotice("");
    setRequestError("");
    setTouched(false);
  };

  const requestMagicLink = async (payload: {
    mode: AuthMode;
    email: string;
    displayName?: string;
  }) => {
    setSubmitState("pending");
    setRequestError("");

    try {
      const response = await fetch("/api/auth/email/start", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, returnTo }),
      });
      const body = await response.json().catch(() => null);

      if (response.ok) {
        setSubmittedEmail(payload.email);
        setAcceptedMessage(typeof body?.message === "string" ? body.message : "");
        setSubmitState("ready");
        return;
      }

      setSubmitState("idle");
      setRequestError(REQUEST_ERROR_MESSAGES[body?.code] ?? GENERIC_REQUEST_ERROR);
    } catch {
      setSubmitState("idle");
      setRequestError(GENERIC_REQUEST_ERROR);
    }
  };

  /**
   * Opens or resumes the account with a password.
   *
   * The closed beta signs the customer in immediately: no mail round trip, no
   * verification step. The magic link stays available as a second route for
   * anyone who would rather not set a password.
   */
  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    setProviderNotice("");
    setRequestError("");

    if (!isValidEmail(email) || password.length < 8) return;
    if (mode === "register" && (!isValidDisplayName(displayName) || !consent)) return;

    setSubmitState("pending");
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          mode,
          email: normalizeEmail(email),
          password,
          displayName: mode === "register" ? displayName.trim() : undefined,
        }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string; returnTo?: string };
      if (!response.ok) throw new Error(body.message ?? "İşlem tamamlanamadı.");

      setPassword("");
      globalThis.location.assign(body.returnTo ?? returnTo);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "İşlem tamamlanamadı.");
      setSubmitState("idle");
    }
  };

  /** The passwordless route, kept for anyone who prefers a mailed link. */
  const sendMagicLink = () => {
    setTouched(true);
    setProviderNotice("");
    if (mode === "signin") {
      if (!isValidEmail(email)) return;
      void requestMagicLink({ mode, email: normalizeEmail(email) });
      return;
    }
    const intent = createRegistrationIntent({ displayName, email, returnTo });
    if (!intent || !consent) return;
    void requestMagicLink({ mode, email: intent.email, displayName: intent.displayName });
  };

  const reset = () => {
    setSubmitState("idle");
    setRequestError("");
    setTouched(false);
  };

  return (
    <section className="authShell">
      <div className="authIntro">
        <span className="eyebrow"><i /> Faz 2 · Kimlik temeli</span>
        <h1>Sunucun hazır.<br /><em>Şimdi güvenceye al.</em></h1>
        <p>Planını hesabına bağlamak, kurulumu izlemek ve kritik işlemleri yalnızca sana açmak için doğrulanmış bir kimlik kullanacağız.</p>

        <div className="authJourney" aria-label="Hesap akışı">
          <article className="ready"><span><Icon name="users" size={18} /></span><div><small>01 · KİMLİK</small><b>Discord, e-posta veya parola</b><p>Kapalı betada parola ile anında giriş.</p></div><em>ARAYÜZ HAZIR</em></article>
          <article><span><Icon name="shield" size={18} /></span><div><small>02 · OTURUM</small><b>Güvenli ve iptal edilebilir</b><p>Tek kullanımlık bağlantı, süreli oturum.</p></div><em>BAĞLANTI BEKLİYOR</em></article>
          <article><span><Icon name="server" size={18} /></span><div><small>03 · TASLAK</small><b>Hesabına bir kez aktarılır</b><p>Sunucu seçimin kaybolmadan devam eder.</p></div><em>{draftFound ? "TASLAK BULUNDU" : "HAZIR"}</em></article>
        </div>

        <div className="authTrust">
          <Icon name="lock" size={19} />
          <p><b>Parolan düz metin olarak saklanmaz.</b> Yalnızca PBKDF2 ile üretilmiş doğrulayıcısı tutulur; oturum belirteçlerinin de yalnızca özeti veritabanındadır. Kapalı betada e-posta adresi doğrulanmıyor.</p>
        </div>
      </div>

      <div className="authCardWrap">
        <div className="authPhaseLabel"><span><i /> Entegrasyon ön izlemesi</span><em>CANLI TESLİMAT ORTAMA BAĞLI</em></div>
        <section className="authCard" aria-labelledby="auth-title">
          <header>
            <span className="authMark"><Icon name="lock" size={21} /></span>
            <div><small>RIFTORY ACCOUNT</small><h2 id="auth-title">{mode === "signin" ? "Tekrar hoş geldin." : "Hesabını oluşturalım."}</h2><p>{mode === "signin" ? "Paneline devam etmek için kimliğini doğrula." : "Planını kaydetmek için bir dakikadan kısa sürer."}</p></div>
          </header>

          <div className="authTabs" role="tablist" aria-label="Hesap işlemi">
            <button aria-selected={mode === "signin"} className={mode === "signin" ? "active" : ""} onClick={() => chooseMode("signin")} role="tab" type="button">Giriş yap</button>
            <button aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => chooseMode("register")} role="tab" type="button">Hesap oluştur</button>
          </div>

          {submitState === "ready" ? (
            <div className="authReady" role="status">
              <span><Icon name="check" size={28} /></span>
              <small>İSTEK ALINDI</small>
              <h3>Gelen kutunu kontrol et.</h3>
              <p><b>{submittedEmail}</b> · {acceptedMessage || "Adres uygunsa tek kullanımlık giriş bağlantısı gönderilecektir."} Bağlantı 10 dakika geçerlidir ve yalnızca bir kez kullanılabilir.</p>
              {draftFound && <div><Icon name="server" size={17} /><span><b>Sunucu taslağın korunuyor</b><small>İlk gerçek girişte hesabına yalnızca bir kez aktarılacak.</small></span></div>}
              <div className="authReadyActions"><button onClick={reset} type="button">Bilgileri düzenle</button><Link href={returnTo}>{returnLabel} <Icon name="arrow" size={15} /></Link></div>
            </div>
          ) : (
            <>
              <a className="discordButton" href={`/api/auth/discord/start?return_to=${encodeURIComponent(returnTo)}`}><span>D</span> Discord ile devam et <Icon name="arrow" size={16} /></a>
              {providerNotice && <p className="providerNotice" role="alert"><Icon name="lock" size={15} /> {providerNotice}</p>}
              <div className="authDivider"><span /> veya e-posta ile <span /></div>

              <form className="authForm" noValidate onSubmit={(event) => { void submitPassword(event); }}>
                {mode === "register" && (
                  <label htmlFor="display-name"><span>Görünen ad</span><input aria-invalid={touched && !isValidDisplayName(displayName)} autoComplete="name" id="display-name" maxLength={60} onChange={(event) => setDisplayName(event.target.value)} placeholder="Sunucu yöneticisi" value={displayName} />{touched && !isValidDisplayName(displayName) && <em>2–60 karakter arasında bir ad gir.</em>}</label>
                )}
                <label htmlFor="auth-email"><span>E-posta adresi</span><input aria-invalid={touched && !isValidEmail(email)} autoComplete="email" id="auth-email" inputMode="email" onChange={(event) => setEmail(event.target.value)} placeholder="oyuncu@example.com" type="email" value={email} />{touched && !isValidEmail(email) && <em>Geçerli bir e-posta adresi gir.</em>}</label>
                <label htmlFor="auth-password"><span>Parola</span><input aria-invalid={touched && password.length > 0 && password.length < 8} autoComplete={mode === "register" ? "new-password" : "current-password"} id="auth-password" maxLength={128} minLength={8} onChange={(event) => setPassword(event.target.value)} placeholder="En az 8 karakter" type="password" value={password} />{touched && password.length < 8 && <em>Parola en az 8 karakter olmalı.</em>}</label>
                {mode === "register" && (
                  <label className="authConsent"><input checked={consent} onChange={(event) => setConsent(event.target.checked)} type="checkbox" /><span>Hesabım ve hizmet bildirimleri için verilerimin işlenmesini kabul ediyorum. <small>{CURRENT_CONSENT_VERSION}</small></span>{touched && !consent && <em>Hesap oluşturmak için zorunlu onayı işaretle.</em>}</label>
                )}
                <button className="button large full" disabled={submitState === "pending"} type="submit">{submitState === "pending" ? "Gönderiliyor…" : mode === "signin" ? "Giriş yap" : "Hesabı oluştur"}<Icon name="arrow" size={18} /></button>
                {requestError && <p className="providerNotice" role="alert"><Icon name="lock" size={15} /> {requestError}</p>}
                <button className="authLinkAlternative" disabled={submitState === "pending"} onClick={sendMagicLink} type="button">Parola yerine e-posta bağlantısı gönder</button>
              </form>
              <p className="authDisclosure"><Icon name="shield" size={14} /> İstek yalnızca bu siteden gönderilir. Canlı teslimat yayın ortamına bağlıdır; kapalıyken adresin işlenmeden açık bir hata döner.</p>
            </>
          )}
        </section>
        <div className="authMeta"><span><Icon name="shield" size={14} /> Parola veya tek kullanımlık bağlantı</span><span><Icon name="clock" size={14} /> 10 dakika hedef süre</span><span><Icon name="lock" size={14} /> Güvenli çerez</span></div>
      </div>
    </section>
  );
}
