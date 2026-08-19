"use client";

import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon, type IconName } from "../_components/icon";
import {
  CONFIGURATOR_STORAGE_KEY,
  DEFAULT_SERVER_DRAFT,
  calculateMonthlyPrice,
  formatTry,
  getGame,
  getPlan,
  getRegion,
  isServerDraft,
  sellableSoftware,
  type ServerDraft,
} from "@/lib/catalog";

type PanelTab = "overview" | "console" | "backups" | "settings";
type ServerStatus = "running" | "stopped" | "restarting";

type ConsoleLine = {
  id: number;
  time: string;
  text: string;
  tone?: "good" | "command" | "muted";
};

type BackupRecord = {
  id: number;
  name: string;
  created: string;
  size: string;
  type: "Otomatik" | "Manuel";
};

const initialConsole: ConsoleLine[] = [
  { id: 1, time: "20:41:02", text: "[Server thread/INFO]: Starting game server" },
  { id: 2, time: "20:41:03", text: "[Server thread/INFO]: Preparing spawn area: 100%" },
  { id: 3, time: "20:41:04", text: "[Server thread/INFO]: Done! Type 'help' for help", tone: "good" },
  { id: 4, time: "20:41:18", text: "[Server thread/INFO]: thepublisher joined the game" },
];

const initialBackups: BackupRecord[] = [
  { id: 1, name: "daily-2026-08-14", created: "Bugün, 04:00", size: "1.8 GB", type: "Otomatik" },
  { id: 2, name: "before-update", created: "Dün, 19:42", size: "1.7 GB", type: "Manuel" },
  { id: 3, name: "daily-2026-08-13", created: "Dün, 04:00", size: "1.7 GB", type: "Otomatik" },
];

const tabItems: { id: PanelTab; label: string; icon: IconName }[] = [
  { id: "overview", label: "Genel bakış", icon: "home" },
  { id: "console", label: "Canlı konsol", icon: "terminal" },
  { id: "backups", label: "Yedekler", icon: "hardDrive" },
  { id: "settings", label: "Sunucu ayarları", icon: "settings" },
];

/** Why the visitor is looking at the demo; written by the panel shell. */
export type DemoNotice = {
  text: string;
  action?: { href: string; label: string };
};

export function PanelDemo({ notice }: { notice?: DemoNotice }) {
  const [draft, setDraft] = useState<ServerDraft>(DEFAULT_SERVER_DRAFT);
  const [tab, setTab] = useState<PanelTab>("overview");
  const [status, setStatus] = useState<ServerStatus>("running");
  const [consoleLines, setConsoleLines] = useState(initialConsole);
  const [backups, setBackups] = useState(initialBackups);
  const [command, setCommand] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const restartTimer = useRef<number | null>(null);
  const consoleId = useRef(10);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(CONFIGURATOR_STORAGE_KEY);
        if (!stored) return;
        const parsed: unknown = JSON.parse(stored);
        if (isServerDraft(parsed)) setDraft(parsed);
      } catch {
        // Geçersiz yerel taslak varsayılan demo sunucusuna düşer.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => () => {
    if (restartTimer.current) window.clearTimeout(restartTimer.current);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const game = getGame(draft.gameId);
  const plan = getPlan(draft.planId);
  const region = getRegion(draft.regionId);
  const software = sellableSoftware(game).find((item) => item.id === draft.softwareId) ?? sellableSoftware(game)[0];
  const monthlyPrice = calculateMonthlyPrice(draft);

  const appendConsole = (text: string, tone?: ConsoleLine["tone"]) => {
    const now = new Date();
    const time = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now);
    consoleId.current += 1;
    const id = consoleId.current;
    setConsoleLines((current) => [...current, { id, time, text, tone }]);
  };

  const changeStatus = (next: "start" | "stop" | "restart") => {
    if (restartTimer.current) window.clearTimeout(restartTimer.current);
    if (next === "stop") {
      setStatus("stopped");
      appendConsole("[Riftory]: Demo sunucusu durduruldu.", "muted");
      setToast("Sunucu durduruldu (demo)");
      return;
    }
    if (next === "start") {
      setStatus("running");
      appendConsole("[Riftory]: Demo sunucusu başlatıldı.", "good");
      setToast("Sunucu başlatıldı (demo)");
      return;
    }
    setStatus("restarting");
    appendConsole("[Riftory]: Yeniden başlatma isteği alındı.", "command");
    setToast("Sunucu yeniden başlatılıyor");
    restartTimer.current = window.setTimeout(() => {
      setStatus("running");
      appendConsole("[Riftory]: Demo sunucusu yeniden çevrimiçi.", "good");
    }, 1300);
  };

  const submitCommand = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const clean = command.trim();
    if (!clean || status !== "running") return;
    appendConsole(`> ${clean}`, "command");
    if (clean.toLowerCase() === "list") appendConsole("There are 7 of a max of 15 players online.", "good");
    else if (clean.toLowerCase() === "help") appendConsole("Available demo commands: help, list, say <message>");
    else appendConsole("Demo komutu işlendi. Gerçek komutlar provisioning fazında RCON üzerinden iletilecek.", "muted");
    setCommand("");
  };

  const createBackup = () => {
    if (status === "restarting") return;
    const next: BackupRecord = { id: Date.now(), name: `manual-${backups.length + 1}`, created: "Az önce", size: "1.8 GB", type: "Manuel" };
    setBackups((current) => [next, ...current]);
    setToast("Manuel yedek oluşturuldu (demo)");
  };

  const statusLabel = status === "running" ? "Çevrimiçi" : status === "restarting" ? "Yeniden başlıyor" : "Durduruldu";

  return (
    <div className="controlShell">
      <aside className="controlSidebar">
        <div className="serverIdentity">
          <span className={`gameBadge ${draft.gameId === "terraria" ? "blue" : ""}`}>{game.letter}</span>
          <span><small>{game.name.toUpperCase()}</small><b>{draft.serverName}</b></span>
        </div>
        <nav aria-label="Sunucu yönetimi">
          {tabItems.map((item) => (
            <button aria-current={tab === item.id ? "page" : undefined} className={tab === item.id ? "active" : ""} key={item.id} onClick={() => setTab(item.id)} type="button">
              <Icon name={item.icon} size={18} /><span>{item.label}</span>{item.id === "console" && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebarHelp"><Icon name="headset" size={19} /><span><b>Bir sorun mu var?</b><small>Destek merkezi Faz 6&apos;da bağlanacak.</small></span></div>
        <Link href="/kurulum"><Icon name="plus" size={17} /> Yapılandırmayı değiştir</Link>
      </aside>

      <section className="controlContent">
        <div className="demoRibbon">
          <Icon name="spark" size={16} />
          <p>
            <b>Çalışan ürün demosu:</b>{" "}
            {notice?.text ?? "butonlar ve panel akışları etkileşimlidir; gerçek bir oyun sunucusuna henüz komut göndermez."}
          </p>
          {notice?.action && <Link href={notice.action.href}>{notice.action.label}</Link>}
        </div>
        <header className="controlTitlebar">
          <div><span><i className={status} /> {statusLabel}</span><h1>{tabItems.find((item) => item.id === tab)?.label}</h1><p>{draft.serverName} · {region.name} / {region.location}</p></div>
          <div className="controlActions">
            {status === "stopped" ? (
              <button className="serverAction start" onClick={() => changeStatus("start")} type="button"><Icon name="play" size={16} /> Başlat</button>
            ) : (
              <button className="serverAction stop" disabled={status === "restarting"} onClick={() => changeStatus("stop")} type="button"><Icon name="power" size={16} /> Durdur</button>
            )}
            <button className="serverAction" disabled={status !== "running"} onClick={() => changeStatus("restart")} type="button"><Icon name="refresh" size={16} /> Yeniden başlat</button>
            <button aria-label="Bildirimler" className="iconAction" type="button"><Icon name="bell" size={18} /><i /></button>
          </div>
        </header>

        <nav className="mobilePanelTabs" aria-label="Panel bölümleri">
          {tabItems.map((item) => <button aria-current={tab === item.id ? "page" : undefined} className={tab === item.id ? "active" : ""} key={item.id} onClick={() => setTab(item.id)} type="button"><Icon name={item.icon} size={17} />{item.label}</button>)}
        </nav>

        {tab === "overview" && (
          <div className="overviewGrid panelView">
            <section className="connectionCard">
              <header><span><Icon name="globe" size={18} /> Bağlantı bilgileri</span><em>PROVISIONING BEKLİYOR</em></header>
              <div><span><small>SUNUCU ADRESİ</small><b>Gerçek kurulumda atanacak</b></span><button disabled title="Adres henüz atanmadı" type="button"><Icon name="copy" size={17} /> Kopyala</button></div>
              <footer><span><i /> {statusLabel}</span><p>Railway TCP Proxy alan adı ve portu Faz 4&apos;te otomatik yazılacak.</p></footer>
            </section>

            <section className="quickStats" aria-label="Kaynak özeti">
              <Stat icon="cpu" label="CPU" value={status === "running" ? "%18" : "%0"} detail={plan.cpu} fill={status === "running" ? 18 : 0} />
              <Stat icon="database" label="RAM" value={status === "running" ? `2.1 / ${plan.ram} GB` : `0 / ${plan.ram} GB`} detail={`${plan.ram} GB paket`} fill={status === "running" ? Math.min(82, Math.round(210 / plan.ram)) : 0} />
              <Stat icon="users" label="Oyuncular" value={status === "running" ? "7 / 15" : "0 / 15"} detail="Son 24 saatte 11" fill={status === "running" ? 47 : 0} />
              <Stat icon="clock" label="Çalışma" value={status === "running" ? "6g 14sa" : "—"} detail="Son kesinti yok" fill={status === "running" ? 86 : 0} />
            </section>

            <section className="usageCard">
              <header><span><small>KAYNAK KULLANIMI</small><b>Son 12 saat</b></span><div><em><i /> RAM</em><em><i /> CPU</em></div></header>
              <div className="usageChart"><span>100%</span><span>50%</span><span>0%</span><i /><i /><i /><i /><i /><svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 700 180"><path className="area" d="M0 145 C50 130 70 74 128 91 S210 132 260 86 S344 48 389 73 S470 122 520 62 S610 44 700 78 L700 180 L0 180Z"/><path className="ramLine" d="M0 145 C50 130 70 74 128 91 S210 132 260 86 S344 48 389 73 S470 122 520 62 S610 44 700 78"/><path className="cpuLine" d="M0 118 C78 104 110 126 170 111 S270 72 318 103 S420 143 465 108 S570 84 620 103 S671 110 700 96"/></svg></div>
              <footer><span>08:00</span><span>12:00</span><span>16:00</span><span>20:00</span></footer>
            </section>

            <section className="detailsCard">
              <header><small>SUNUCU DETAYLARI</small><Link href="/kurulum">Düzenle <Icon name="arrow" size={14} /></Link></header>
              <dl><div><dt>Oyun</dt><dd>{game.name}</dd></div><div><dt>Yazılım</dt><dd>{software.name}</dd></div><div><dt>Paket</dt><dd>{plan.label} · {plan.ram} GB</dd></div><div><dt>Depolama</dt><dd>{plan.storage} GB NVMe</dd></div><div><dt>Yedek</dt><dd>{draft.backups ? "Günlük" : "Manuel"}</dd></div><div><dt>Tahmini fiyat</dt><dd>{formatTry(monthlyPrice)}/ay</dd></div></dl>
            </section>

            <section className="activityCard">
              <header><small>SON HAREKETLER</small><button onClick={() => setTab("console")} type="button">Tümünü gör</button></header>
              <ul><li><span className="good"><Icon name="play" size={13} /></span><p><b>Sunucu başlatıldı</b><small>Bugün, 20:41</small></p></li><li><span><Icon name="download" size={13} /></span><p><b>Paper yapılandırması hazırlandı</b><small>Bugün, 20:39</small></p></li><li><span><Icon name="hardDrive" size={13} /></span><p><b>Otomatik yedek tamamlandı</b><small>Bugün, 04:00</small></p></li></ul>
            </section>
          </div>
        )}

        {tab === "console" && (
          <div className="consoleView panelView">
            <section className="fullConsole">
              <header><span><i /><i /><i /></span><small>CANLI KONSOL · DEMO</small><em className={status}>{status === "running" ? "● LIVE" : status === "restarting" ? "● RESTARTING" : "● OFFLINE"}</em></header>
              <div aria-live="polite">{consoleLines.map((line) => <p className={line.tone ?? ""} key={line.id}><span>{line.time}</span>{line.text}</p>)}</div>
              <form onSubmit={submitCommand}><span>›</span><input aria-label="Konsol komutu" disabled={status !== "running"} onChange={(event) => setCommand(event.target.value)} placeholder={status === "running" ? "Bir demo komutu yaz: help veya list" : "Komut göndermek için sunucuyu başlat"} value={command} /><button disabled={!command.trim() || status !== "running"} type="submit">Gönder <Icon name="arrow" size={15} /></button></form>
            </section>
            <aside className="consoleHelp"><span><Icon name="terminal" /></span><h2>Demo komutları</h2><p>Gerçek sürümde bu alan RCON üzerinden oyun sunucusuna güvenli komut gönderecek.</p><button onClick={() => setCommand("help")} type="button"><code>help</code><span>Komutları göster</span></button><button onClick={() => setCommand("list")} type="button"><code>list</code><span>Oyuncuları listele</span></button><button onClick={() => setCommand("say Merhaba dünya!")} type="button"><code>say</code><span>Sunucu mesajı gönder</span></button></aside>
          </div>
        )}

        {tab === "backups" && (
          <div className="backupsView panelView">
            <section className="backupHero"><span><Icon name="shield" size={25} /></span><div><small>YEDEKLEME DURUMU</small><h2>{draft.backups ? "Günlük koruma açık" : "Otomatik yedek kapalı"}</h2><p>{draft.backups ? "Her gün 04:00'te otomatik geri dönüş noktası hazırlanacak." : "Yine de dilediğin zaman manuel demo yedeği oluşturabilirsin."}</p></div><button className="button" onClick={createBackup} type="button"><Icon name="hardDrive" size={17} /> Şimdi yedek al</button></section>
            <section className="backupTable"><header><span><small>GERİ DÖNÜŞ NOKTALARI</small><b>{backups.length} yedek</b></span><em>Toplam 5.2 GB</em></header><div role="table">{backups.map((backup) => <div className="backupRow" key={backup.id} role="row"><span className="backupFile"><Icon name="database" size={18} /><span><b>{backup.name}</b><small>{backup.created}</small></span></span><span>{backup.type}</span><span>{backup.size}</span><button onClick={() => setToast("Geri yükleme Faz 5'te gerçek sunucuya bağlanacak")} type="button">Geri yükle</button></div>)}</div></section>
          </div>
        )}

        {tab === "settings" && (
          <div className="settingsView panelView">
            <section className="settingsCard"><header><span><Icon name="settings" size={19} /><span><small>SUNUCU PROFİLİ</small><b>Temel bilgiler</b></span></span><Link href="/kurulum">Yapılandırıcıda değiştir</Link></header><dl><div><dt>Sunucu adı</dt><dd>{draft.serverName}</dd></div><div><dt>Oyun ve yazılım</dt><dd>{game.name} · {software.name}</dd></div><div><dt>Dağıtım bölgesi</dt><dd>{region.name} · {region.location}</dd></div><div><dt>Paket</dt><dd>{plan.label} · {plan.ram} GB RAM</dd></div></dl></section>
            <section className="settingsCard"><header><span><Icon name="wallet" size={19} /><span><small>PLAN VE FATURALAMA</small><b>Beta fiyat özeti</b></span></span><em>ÖDEME KAPALI</em></header><div className="billingSummary"><span><small>AYLIK TAHMİN</small><b>{formatTry(monthlyPrice)}</b></span><p>Hesap, ödeme yöntemi, yenileme ve iptal akışları Faz 2–3 içinde eklenecek.</p></div></section>
            <section className="settingsCard dangerCard"><header><span><Icon name="shield" size={19} /><span><small>TEHLİKELİ İŞLEMLER</small><b>Sunucuyu sil</b></span></span><Icon name="lock" size={17} /></header><p>Gerçek sunucu olmadığı için bu işlem kilitli. Üretim sürümünde yeniden kimlik doğrulama, sunucu adı onayı ve geri alma süresi gerektirecek.</p><button disabled type="button">Sunucuyu sil</button></section>
          </div>
        )}
      </section>

      {toast && <div className="panelToast" role="status"><Icon name="check" size={17} /> {toast}</div>}
    </div>
  );
}

function Stat({ icon, label, value, detail, fill }: { icon: IconName; label: string; value: string; detail: string; fill: number }) {
  return <article><header><span><Icon name={icon} size={15} /> {label}</span><em>{detail}</em></header><b>{value}</b><i><span style={{ width: `${fill}%` }} /></i></article>;
}
