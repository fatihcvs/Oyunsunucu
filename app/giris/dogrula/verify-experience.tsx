"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "../../_components/icon";

type VerifyState = "ready" | "pending" | "done" | "error";

const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

const ERROR_MESSAGES: Record<string, string> = {
  AUTH_NOT_CONFIGURED: "Canlı giriş henüz açık değil. Yayın ortamı bağlandığında bu bağlantı çalışacak.",
  AUTH_ADAPTER_NOT_BOUND: "Kimlik deposu yayın ortamında henüz bağlı değil; oturum oluşturulmadı.",
  INVALID_OR_EXPIRED_LINK: "Bağlantı geçersiz veya süresi dolmuş. Giriş sayfasından yeni bir bağlantı iste.",
  RATE_LIMITED: "Çok fazla deneme yapıldı. Kısa bir süre sonra yeniden dene.",
};

const GENERIC_ERROR = "Doğrulama şu anda tamamlanamadı. Lütfen daha sonra yeniden dene.";

export function VerifyExperience({ token }: { token: string }) {
  const hasUsableToken = OPAQUE_TOKEN.test(token);
  const [state, setState] = useState<VerifyState>(hasUsableToken ? "ready" : "error");
  const [message, setMessage] = useState(hasUsableToken ? "" : ERROR_MESSAGES.INVALID_OR_EXPIRED_LINK);

  const confirm = async () => {
    setState("pending");
    setMessage("");

    try {
      const response = await fetch("/api/auth/email/verify", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = await response.json().catch(() => null);

      if (response.ok && payload?.returnTo) {
        setState("done");
        window.location.assign(payload.returnTo);
        return;
      }

      setState("error");
      setMessage(ERROR_MESSAGES[payload?.code] ?? GENERIC_ERROR);
    } catch {
      setState("error");
      setMessage(GENERIC_ERROR);
    }
  };

  return (
    <section className="authShell">
      <div className="authIntro">
        <span className="eyebrow"><i /> Faz 2 · Bağlantı doğrulama</span>
        <h1>Son bir adım<br /><em>kaldı.</em></h1>
        <p>Bu bağlantı tek kullanımlıktır ve yalnızca senin onayınla tüketilir. Onay adımı, e-posta tarayıcılarının bağlantıyı senin yerine açıp harcamasını engeller.</p>

        <div className="authTrust">
          <Icon name="lock" size={19} />
          <p><b>Bağlantıyı sen istemediysen kapat.</b> Onaylamadığın sürece hesabında hiçbir değişiklik olmaz.</p>
        </div>
      </div>

      <div className="authCardWrap">
        <div className="authPhaseLabel"><span><i /> Tek kullanımlık bağlantı</span><em>10 DAKİKA GEÇERLİ</em></div>
        <section className="authCard" aria-labelledby="verify-title">
          <header>
            <span className="authMark"><Icon name="shield" size={21} /></span>
            <div><small>RIFTORY ACCOUNT</small><h2 id="verify-title">Girişini tamamla</h2><p>Onayladığında güvenli oturum çerezin oluşturulur.</p></div>
          </header>

          {state === "done" ? (
            <div className="authReady" role="status">
              <span><Icon name="check" size={28} /></span>
              <small>OTURUM OLUŞTURULDU</small>
              <h3>Giriş tamamlandı.</h3>
              <p>Panele yönlendiriliyorsun.</p>
            </div>
          ) : (
            <div className="verifyAction">
              <button
                className="button large full"
                disabled={state === "pending" || !hasUsableToken}
                onClick={confirm}
                type="button"
              >
                {state === "pending" ? "Doğrulanıyor…" : "Girişi tamamla"}
                <Icon name="arrow" size={18} />
              </button>

              {state === "error" && (
                <p className="providerNotice" role="alert"><Icon name="lock" size={15} /> {message}</p>
              )}

              <p className="authDisclosure">
                <Icon name="shield" size={14} /> Onay isteği yalnızca bu siteden gönderilir; bağlantı tüketildikten sonra ikinci kez kullanılamaz.
              </p>

              <div className="authReadyActions">
                <Link href="/giris">Yeni bağlantı iste</Link>
                <Link href="/">Ana sayfa <Icon name="arrow" size={15} /></Link>
              </div>
            </div>
          )}
        </section>
        <div className="authMeta"><span><Icon name="shield" size={14} /> Tek kullanımlık bağlantı</span><span><Icon name="clock" size={14} /> 10 dakika geçerli</span><span><Icon name="lock" size={14} /> Güvenli çerez</span></div>
      </div>
    </section>
  );
}
