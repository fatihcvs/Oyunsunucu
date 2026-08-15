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

type SubmitState = "idle" | "ready";

export function AuthExperience({ initialMode, returnTo }: { initialMode: AuthMode; returnTo: string }) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [consent, setConsent] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [providerNotice, setProviderNotice] = useState(false);
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
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const chooseMode = (next: AuthMode) => {
    setMode(next);
    setSubmitState("idle");
    setProviderNotice(false);
    setTouched(false);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    setProviderNotice(false);

    if (mode === "signin") {
      if (!isValidEmail(email)) return;
      setSubmittedEmail(normalizeEmail(email));
      setSubmitState("ready");
      return;
    }

    const intent = createRegistrationIntent({ displayName, email, returnTo });
    if (!intent || !consent) return;
    setSubmittedEmail(intent.email);
    setSubmitState("ready");
  };

  const reset = () => {
    setSubmitState("idle");
    setTouched(false);
  };

  return (
    <section className="authShell">
      <div className="authIntro">
        <span className="eyebrow"><i /> Faz 2 · Kimlik temeli</span>
        <h1>Sunucun hazır.<br /><em>Şimdi güvenceye al.</em></h1>
        <p>Planını hesabına bağlamak, kurulumu izlemek ve kritik işlemleri yalnızca sana açmak için doğrulanmış bir kimlik kullanacağız.</p>

        <div className="authJourney" aria-label="Hesap akışı">
          <article className="ready"><span><Icon name="users" size={18} /></span><div><small>01 · KİMLİK</small><b>Discord veya e-posta</b><p>Şifresiz, doğrulanmış giriş.</p></div><em>ARAYÜZ HAZIR</em></article>
          <article><span><Icon name="shield" size={18} /></span><div><small>02 · OTURUM</small><b>Güvenli ve iptal edilebilir</b><p>Tek kullanımlık bağlantı, süreli oturum.</p></div><em>BAĞLANTI BEKLİYOR</em></article>
          <article><span><Icon name="server" size={18} /></span><div><small>03 · TASLAK</small><b>Hesabına bir kez aktarılır</b><p>Sunucu seçimin kaybolmadan devam eder.</p></div><em>{draftFound ? "TASLAK BULUNDU" : "HAZIR"}</em></article>
        </div>

        <div className="authTrust">
          <Icon name="lock" size={19} />
          <p><b>Parola saklamıyoruz.</b> E-posta akışı tek kullanımlık bağlantıyla çalışacak; oturum belirteçlerinin yalnızca özeti veritabanında tutulacak.</p>
        </div>
      </div>

      <div className="authCardWrap">
        <div className="authPhaseLabel"><span><i /> Entegrasyon ön izlemesi</span><em>GERÇEK HESAP OLUŞTURMA KAPALI</em></div>
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
              <small>FORM DOĞRULANDI</small>
              <h3>Doğrulama adımı hazır.</h3>
              <p><b>{submittedEmail}</b> için gerçek bir e-posta gönderilmedi. PostgreSQL, e-posta sağlayıcısı ve oturum sırrı bağlandığında bu ekran tek kullanımlık bağlantıyı gönderecek.</p>
              {draftFound && <div><Icon name="server" size={17} /><span><b>Sunucu taslağın korunuyor</b><small>İlk gerçek girişte hesabına yalnızca bir kez aktarılacak.</small></span></div>}
              <div className="authReadyActions"><button onClick={reset} type="button">Bilgileri düzenle</button><Link href={returnTo}>{returnLabel} <Icon name="arrow" size={15} /></Link></div>
            </div>
          ) : (
            <>
              <button className="discordButton" onClick={() => setProviderNotice(true)} type="button"><span>D</span> Discord ile devam et <Icon name="arrow" size={16} /></button>
              {providerNotice && <p className="providerNotice" role="status"><Icon name="lock" size={15} /> Discord istemci anahtarları henüz bağlı değil; bu önizlemede dış istek gönderilmedi.</p>}
              <div className="authDivider"><span /> veya e-posta ile <span /></div>

              <form className="authForm" noValidate onSubmit={submit}>
                {mode === "register" && (
                  <label htmlFor="display-name"><span>Görünen ad</span><input aria-invalid={touched && !isValidDisplayName(displayName)} autoComplete="name" id="display-name" maxLength={60} onChange={(event) => setDisplayName(event.target.value)} placeholder="Sunucu yöneticisi" value={displayName} />{touched && !isValidDisplayName(displayName) && <em>2–60 karakter arasında bir ad gir.</em>}</label>
                )}
                <label htmlFor="auth-email"><span>E-posta adresi</span><input aria-invalid={touched && !isValidEmail(email)} autoComplete="email" id="auth-email" inputMode="email" onChange={(event) => setEmail(event.target.value)} placeholder="oyuncu@example.com" type="email" value={email} />{touched && !isValidEmail(email) && <em>Geçerli bir e-posta adresi gir.</em>}</label>
                {mode === "register" && (
                  <label className="authConsent"><input checked={consent} onChange={(event) => setConsent(event.target.checked)} type="checkbox" /><span>Hesabım ve hizmet bildirimleri için verilerimin işlenmesini kabul ediyorum. <small>{CURRENT_CONSENT_VERSION}</small></span>{touched && !consent && <em>Hesap oluşturmak için zorunlu onayı işaretle.</em>}</label>
                )}
                <button className="button large full" type="submit">{mode === "signin" ? "Güvenli bağlantı iste" : "Hesabı doğrulamaya başla"}<Icon name="arrow" size={18} /></button>
              </form>
              <p className="authDisclosure"><Icon name="shield" size={14} /> Bu geliştirme sürümü yalnızca formu yerelde doğrular; e-posta göndermez, oturum açmaz ve kişisel veri kaydetmez.</p>
            </>
          )}
        </section>
        <div className="authMeta"><span><Icon name="shield" size={14} /> Tek kullanımlık bağlantı</span><span><Icon name="clock" size={14} /> 10 dakika hedef süre</span><span><Icon name="lock" size={14} /> Güvenli çerez</span></div>
      </div>
    </section>
  );
}
