"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../_components/icon";
import {
  ACTIVE_GAMES,
  BACKUP_MONTHLY_PRICE,
  CONFIGURATOR_STORAGE_KEY,
  DEFAULT_SERVER_DRAFT,
  HOSTING_PLANS,
  HOSTING_REGIONS,
  calculateMonthlyPrice,
  formatTry,
  getGame,
  getPlan,
  getRegion,
  isServerDraft,
  sellableSoftware,
  type ActiveGameId,
  type ServerDraft,
} from "@/lib/catalog";

type ConfiguratorStep = 1 | 2 | 3 | 4;

const stepLabels = ["Oyun", "Yazılım ve paket", "Sunucu bilgileri", "Özet"];

type ConfiguratorProps = {
  initialDraft?: ServerDraft;
  requestedGameId?: ActiveGameId;
  requestedPlanId?: string;
};

export function Configurator({
  initialDraft = DEFAULT_SERVER_DRAFT,
  requestedGameId,
  requestedPlanId,
}: ConfiguratorProps) {
  const router = useRouter();
  const [step, setStep] = useState<ConfiguratorStep>(1);
  const [draft, setDraft] = useState<ServerDraft>(initialDraft);
  const [hydrated, setHydrated] = useState(false);

  const game = getGame(draft.gameId);
  const plan = getPlan(draft.planId);
  const region = getRegion(draft.regionId);
  const software = sellableSoftware(game).find((item) => item.id === draft.softwareId) ?? sellableSoftware(game)[0];
  const monthlyPrice = calculateMonthlyPrice(draft);
  const nameValid = draft.serverName.trim().length >= 3;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      let nextDraft = DEFAULT_SERVER_DRAFT;
      try {
        const stored = window.localStorage.getItem(CONFIGURATOR_STORAGE_KEY);
        if (stored) {
          const parsed: unknown = JSON.parse(stored);
          if (isServerDraft(parsed)) nextDraft = parsed;
        }
      } catch {
        // Bozuk yerel taslak sessizce varsayılan değerlerle değiştirilir.
      } finally {
        const requestedGame = ACTIVE_GAMES.find((item) => item.id === requestedGameId);
        const requestedPlan = HOSTING_PLANS.find((item) => item.id === requestedPlanId);

        if (requestedGame) {
          nextDraft = {
            ...nextDraft,
            gameId: requestedGame.id,
            softwareId: sellableSoftware(requestedGame)[0]?.id ?? "",
          };
        }
        if (requestedPlan) nextDraft = { ...nextDraft, planId: requestedPlan.id };

        setDraft(nextDraft);
        setHydrated(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [requestedGameId, requestedPlanId]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(CONFIGURATOR_STORAGE_KEY, JSON.stringify(draft));
  }, [draft, hydrated]);

  const updateDraft = (patch: Partial<ServerDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const selectGame = (gameId: ActiveGameId) => {
    const selectedGame = getGame(gameId);
    updateDraft({ gameId, softwareId: sellableSoftware(selectedGame)[0]?.id ?? "" });
  };

  const goNext = () => {
    if (step === 3 && !nameValid) return;
    setStep((current) => Math.min(4, current + 1) as ConfiguratorStep);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goBack = () => {
    setStep((current) => Math.max(1, current - 1) as ConfiguratorStep);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const continueToAccount = () => {
    // The draft is written before navigating so the sign-in page and the later
    // account import both read the choice the visitor just confirmed.
    window.localStorage.setItem(CONFIGURATOR_STORAGE_KEY, JSON.stringify(draft));
    router.push("/giris?mode=register&return_to=%2Fpanel");
  };

  return (
    <section className="configuratorShell">
      <aside className="configuratorIntro">
        <span className="eyebrow"><i /> Faz 1 · Çalışan akış</span>
        <h1>Sunucunu<br /><em>adım adım kur.</em></h1>
        <p>Seçimlerin anında fiyatlandırılır. Bu sürümde ödeme alınmaz; oluşturduğun plan müşteri paneli demosuna aktarılır.</p>

        <ol className="configuratorProgress" aria-label="Kurulum adımları">
          {stepLabels.map((label, index) => {
            const stepNumber = (index + 1) as ConfiguratorStep;
            const state = stepNumber < step ? "done" : stepNumber === step ? "active" : "";
            return (
              <li className={state} key={label}>
                <button onClick={() => { if (stepNumber <= step) setStep(stepNumber); }} type="button">
                  <span>{stepNumber < step ? <Icon name="check" size={15} /> : stepNumber}</span>
                  <div><small>ADIM {stepNumber}</small><b>{label}</b></div>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="draftStatus">
          <Icon name={hydrated ? "check" : "shield"} size={17} />
          <span><b>{hydrated ? "Taslak otomatik kaydediliyor" : "Taslak hazırlanıyor"}</b><small>Seçimler şimdilik yalnızca bu cihazda tutulur.</small></span>
        </div>
      </aside>

      <div className="configuratorWorkspace">
        <header className="workspaceHeader">
          <span><small>RIFTORY CONFIGURATOR</small><b>{stepLabels[step - 1]}</b></span>
          <em>{step} / 4</em>
        </header>

        <div className="workspaceBody">
          {step === 1 && (
            <div className="configStep" key="game">
              <StepHeading icon="gamepad" title="Oyununu seç" text="İlk beta TCP tabanlı ve Railway üzerinde güvenle çalıştırılabilen oyunlarla açılıyor." />
              <div className="largeGameChoices">
                {ACTIVE_GAMES.map((item) => (
                  <button
                    aria-pressed={draft.gameId === item.id}
                    className={draft.gameId === item.id ? "selected" : ""}
                    key={item.id}
                    onClick={() => selectGame(item.id)}
                    style={{ "--choice-color": item.color } as CSSProperties}
                    type="button"
                  >
                    <span className="largeGameLetter">{item.letter}</span>
                    <span className="largeGameCopy"><small>{item.tag} · {item.protocol}</small><b>{item.name}</b><em>{item.desc}</em></span>
                    <span className="choiceCheck"><Icon name="check" size={16} /></span>
                  </button>
                ))}
              </div>
              <div className="comingGames"><span><b>FiveM</b><small>UDP ağı sonrası</small></span><i /><span><b>Rust</b><small>UDP ağı sonrası</small></span><i /><span><b>Daha fazlası</b><small>Talebe göre</small></span></div>
            </div>
          )}

          {step === 2 && (
            <div className="configStep" key="resources">
              <StepHeading icon="layers" title="Yazılım ve kaynaklar" text="Sunucu yazılımını ve oyuncu sayına uygun paketi belirle. Daha sonra veri kaybetmeden yükseltebilirsin." />
              <fieldset className="configFieldset">
                <legend>Sunucu yazılımı</legend>
                <div className="softwareChoices">
                  {sellableSoftware(game).map((item) => (
                    <button aria-pressed={draft.softwareId === item.id} className={draft.softwareId === item.id ? "selected" : ""} key={item.id} onClick={() => updateDraft({ softwareId: item.id })} type="button">
                      <span><b>{item.name}</b>{item.recommended && <em>ÖNERİLEN</em>}</span>
                      <small>{item.description}</small>
                      <Icon name="check" size={15} />
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="configFieldset">
                <legend>Kaynak paketi <span>{plan.players}</span></legend>
                <div className="planChoices">
                  {HOSTING_PLANS.map((item) => (
                    <button aria-pressed={draft.planId === item.id} className={draft.planId === item.id ? "selected" : ""} key={item.id} onClick={() => updateDraft({ planId: item.id })} type="button">
                      <small>{item.label}</small><b>{item.ram} GB <em>RAM</em></b><span>{item.storage} GB NVMe</span><strong>{formatTry(item.price)}<i>/ay</i></strong>
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="resourceHint"><Icon name="activity" size={18} /><span><b>Performans koruması</b><small>Beta sırasında kaynak kullanımı izlenecek; paket sınırına yaklaşıldığında yükseltme önerisi gösterilecek.</small></span></div>
            </div>
          )}

          {step === 3 && (
            <div className="configStep" key="details">
              <StepHeading icon="settings" title="Sunucunu kişiselleştir" text="Panelde göreceğin adı, çalışacağı bölgeyi ve yedekleme tercihini belirle." />
              <label className="textField" htmlFor="server-name">
                <span>Sunucu adı <small>3–40 karakter</small></span>
                <input id="server-name" maxLength={40} onChange={(event) => updateDraft({ serverName: event.target.value })} placeholder="Örn. Fatih'in Dünyası" value={draft.serverName} />
                {!nameValid && <em>En az 3 karakterlik bir sunucu adı gir.</em>}
              </label>
              <fieldset className="configFieldset regionFieldset">
                <legend>Dağıtım bölgesi</legend>
                {HOSTING_REGIONS.map((item) => (
                  <button aria-pressed={true} className="regionOption selected" key={item.id} type="button">
                    <span>{item.flag}</span><div><b>{item.name}</b><small>{item.location} · {item.note}</small></div><em>DAHİL</em><Icon name="check" size={16} />
                  </button>
                ))}
                <div className="futureRegion"><span>🇹🇷</span><div><b>İstanbul</b><small>UDP destekli ikinci sağlayıcı fazında</small></div><em>PLANLANIYOR</em><Icon name="lock" size={15} /></div>
              </fieldset>
              <button aria-checked={draft.backups} className={`backupOption ${draft.backups ? "selected" : ""}`} onClick={() => updateDraft({ backups: !draft.backups })} role="switch" type="button">
                <span className="backupIcon"><Icon name="hardDrive" /></span>
                <span><b>Otomatik günlük yedek</b><small>Dosyaların için günlük geri dönüş noktası. Manuel yedek panelden ayrıca alınabilir.</small></span>
                <strong>+{formatTry(BACKUP_MONTHLY_PRICE)}<small>/ay</small></strong>
                <i><b /></i>
              </button>
            </div>
          )}

          {step === 4 && (
            <div className="configStep" key="summary">
              <StepHeading icon="check" title="Planın hazır" text="Bu henüz ücretli bir sipariş değil. Sonraki fazlarda hesap, ödeme ve otomatik kurulum bu özete bağlanacak." />
              <div className="configurationSummary">
                <header>
                  <span className={`gameBadge ${draft.gameId === "terraria" ? "blue" : ""}`}>{game.letter}</span>
                  <span><small>OLUŞTURULACAK SUNUCU</small><b>{draft.serverName.trim()}</b><em>{game.name} · {software.name}</em></span>
                  <strong><i /> Hazır taslak</strong>
                </header>
                <dl>
                  <div><dt><Icon name="cpu" size={17} /> Kaynak</dt><dd>{plan.ram} GB RAM · {plan.cpu}</dd></div>
                  <div><dt><Icon name="hardDrive" size={17} /> Depolama</dt><dd>{plan.storage} GB NVMe</dd></div>
                  <div><dt><Icon name="globe" size={17} /> Bölge</dt><dd>{region.name} · {region.location}</dd></div>
                  <div><dt><Icon name="shield" size={17} /> Yedekleme</dt><dd>{draft.backups ? "Her gün otomatik" : "Yalnızca manuel"}</dd></div>
                </dl>
                <div className="summaryPrice">
                  <span><small>TAHMİNİ AYLIK TUTAR</small><b>{formatTry(monthlyPrice)} <em>/ ay</em></b><i>KDV dahil beta fiyatı · ödeme alınmıyor</i></span>
                  <span><small>İLK KURULUM</small><b>0 TL</b><i>Kurulum ücreti planlanmıyor</i></span>
                </div>
              </div>
              <div className="honestyNote"><Icon name="shield" size={19} /><p><b>Şeffaf geliştirme notu</b> Bu akış fiyat ve ürün deneyimini doğruluyor. Gerçek sipariş numarası, ödeme ve Railway üzerinde sunucu oluşturma henüz bağlı değil.</p></div>
            </div>
          )}
        </div>

        <footer className="workspaceFooter">
          <button className="backButton" disabled={step === 1} onClick={goBack} type="button">← Geri</button>
          <div className="liveEstimate"><span>{game.name} · {plan.ram} GB</span><b>{formatTry(monthlyPrice)}<small>/ay</small></b></div>
          {step < 4 ? (
            <button className="button large" disabled={step === 3 && !nameValid} onClick={goNext} type="button">Devam et <Icon name="arrow" size={18} /></button>
          ) : (
            <button className="button large" onClick={continueToAccount} type="button">Hesapla devam et <Icon name="arrow" size={18} /></button>
          )}
        </footer>
      </div>
    </section>
  );
}

function StepHeading({ icon, title, text }: { icon: "gamepad" | "layers" | "settings" | "check"; title: string; text: string }) {
  return (
    <header className="stepHeading">
      <span><Icon name={icon} size={21} /></span>
      <div><h2>{title}</h2><p>{text}</p></div>
    </header>
  );
}
