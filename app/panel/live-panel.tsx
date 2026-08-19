"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon, type IconName } from "../_components/icon";
import { AssistantCard } from "./assistant-card";
import { ConsoleCard } from "./console-card";
import { ScheduleCard, type Schedule } from "./schedule-card";
import { ServerSettingsCard, type SettingField, type SettingValue } from "./server-settings-card";
import { getGame, getPlan, getRegion, type GameId } from "@/lib/catalog";

export type PanelServer = {
  serverId: string;
  name: string;
  status: string;
  gameId: string;
  softwareId: string;
  planId: string;
  regionId: string;
  connection: { host: string; port: number } | null;
  busyWith: string | null;
  availableCommands: string[];
  settingFields: SettingField[];
  settings: Record<string, SettingValue>;
  canEditSettings: boolean;
  schedule: Schedule | null;
  createdAt: string;
  updatedAt: string;
};

type StatusLook = {
  label: string;
  /** Which dot the title bar shows; matches the demo's three visual states. */
  tone: "online" | "pending" | "stopped" | "failed";
};

const STATUS_LOOK: Record<string, StatusLook> = {
  requested: { label: "Sıraya alındı", tone: "pending" },
  provisioning: { label: "Kuruluyor", tone: "pending" },
  deploying: { label: "Dağıtılıyor", tone: "pending" },
  online: { label: "Çevrimiçi", tone: "online" },
  failed: { label: "Kurulum başarısız", tone: "failed" },
  suspended: { label: "Durduruldu", tone: "stopped" },
  deleting: { label: "Siliniyor", tone: "pending" },
  deleted: { label: "Silindi", tone: "stopped" },
};

const COMMAND_LOOK: Record<string, { label: string; icon: IconName; variant: string }> = {
  baslat: { label: "Başlat", icon: "play", variant: "start" },
  durdur: { label: "Durdur", icon: "power", variant: "stop" },
  "yeniden-baslat": { label: "Yeniden başlat", icon: "refresh", variant: "" },
};

/** What the customer is told is happening while a job runs. */
const BUSY_LABEL: Record<string, string> = {
  create_server: "Sunucu kuruluyor",
  start_server: "Başlatılıyor",
  stop_server: "Durduruluyor",
  restart_server: "Yeniden başlatılıyor",
  delete_server: "Siliniyor",
};

const REFRESH_MS = 5_000;

function statusLook(status: string): StatusLook {
  return STATUS_LOOK[status] ?? { label: status, tone: "pending" };
}

function formatMoment(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function LivePanel({
  servers,
  onRefresh,
}: {
  servers: PanelServer[];
  onRefresh: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState(servers[0]?.serverId ?? "");
  const [toast, setToast] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);

  // Derived, not stored: a server the customer no longer has simply falls back
  // to the first one instead of leaving the panel pointing at nothing.
  const active = servers.find((server) => server.serverId === selectedId) ?? servers[0];

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  // The worker changes state out of band, so a server mid-operation is polled
  // until it settles. A settled server is left alone rather than polled forever.
  const busy = servers.some((server) => server.busyWith !== null);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => { void onRefresh(); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [busy, onRefresh]);

  const sendCommand = useCallback(async (command: string) => {
    if (!active || sending) return;
    setSending(true);
    try {
      const response = await fetch("/api/servers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serverId: active.serverId, command }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setToast(body?.message ?? "İstek gönderilemedi.");
        return;
      }
      setToast("İstek sıraya alındı.");
      await onRefresh();
    } catch {
      setToast("Sunucuya ulaşılamadı.");
    } finally {
      setSending(false);
    }
  }, [active, sending, onRefresh]);

  if (!active) return null;

  const game = getGame(active.gameId as GameId);
  const plan = getPlan(active.planId);
  const region = getRegion(active.regionId);
  const software = game.software.find((item) => item.id === active.softwareId);
  const look = statusLook(active.status);
  const address = active.connection ? `${active.connection.host}:${active.connection.port}` : null;

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      setToast("Adres kopyalanamadı; elle seçebilirsin.");
    }
  };

  return (
    <div className="controlShell">
      <aside className="controlSidebar">
        <div className="serverIdentity">
          <span className={`gameBadge ${active.gameId === "terraria" ? "blue" : ""}`}>{game.letter}</span>
          <span>
            <small>{game.name.toUpperCase()}</small>
            <b>{active.name}</b>
          </span>
        </div>

        <nav aria-label="Sunucularım" className="serverSwitch">
          {servers.map((server) => {
            const serverLook = statusLook(server.status);
            return (
              <button
                aria-current={server.serverId === active.serverId ? "page" : undefined}
                className={server.serverId === active.serverId ? "active" : ""}
                key={server.serverId}
                onClick={() => setSelectedId(server.serverId)}
                type="button"
              >
                <Icon name="server" size={17} />
                <span>{server.name}</span>
                <i className={serverLook.tone} />
              </button>
            );
          })}
        </nav>

        <div className="sidebarHelp">
          <Icon name="headset" size={19} />
          <span>
            <b>Bir sorun mu var?</b>
            <small>Destek kanalı henüz açılmadı; hata durumunda kurulum kaydı burada görünür.</small>
          </span>
        </div>
        <Link href="/kurulum"><Icon name="plus" size={17} /> Yeni sunucu yapılandır</Link>
      </aside>

      <section className="controlContent">
        <header className="controlTitlebar">
          <div>
            <span className={look.tone}>
              <i className={look.tone} /> {active.busyWith ? BUSY_LABEL[active.busyWith] ?? look.label : look.label}
            </span>
            <h1>{active.name}</h1>
            <p>{game.name} · {plan.label} {plan.ram} GB · {region.name} / {region.location}</p>
          </div>
          <div className="controlActions">
            {active.availableCommands.map((command) => {
              const commandLook = COMMAND_LOOK[command];
              if (!commandLook) return null;
              return (
                <button
                  className={`serverAction ${commandLook.variant}`}
                  disabled={sending}
                  key={command}
                  onClick={() => { void sendCommand(command); }}
                  type="button"
                >
                  <Icon name={commandLook.icon} size={16} /> {commandLook.label}
                </button>
              );
            })}
            {active.availableCommands.length === 0 && (
              <span className="actionsBlocked">
                {active.busyWith ? "İşlem sürüyor" : "Bu durumda işlem yok"}
              </span>
            )}
          </div>
        </header>

        <div className="overviewGrid panelView">
          <section className="connectionCard">
            <header>
              <span><Icon name="globe" size={18} /> Bağlantı bilgileri</span>
              <em>{address ? "ATANDI" : "HENÜZ ATANMADI"}</em>
            </header>
            <div>
              <span>
                <small>SUNUCU ADRESİ</small>
                <b>{address ?? "Kurulum tamamlanınca yazılacak"}</b>
              </span>
              <button
                disabled={!address}
                onClick={() => { void copyAddress(); }}
                title={address ? "Adresi kopyala" : "Adres henüz atanmadı"}
                type="button"
              >
                <Icon name={copied ? "check" : "copy"} size={17} /> {copied ? "Kopyalandı" : "Kopyala"}
              </button>
            </div>
            <footer>
              <span><i className={look.tone} /> {look.label}</span>
              <p>Bu adres durdur/başlat işlemlerinde değişmez.</p>
            </footer>
          </section>

          <section className="detailsCard">
            <header><small>SUNUCU DETAYLARI</small></header>
            <dl>
              <div><dt>Oyun</dt><dd>{game.name}</dd></div>
              <div><dt>Yazılım</dt><dd>{software?.name ?? active.softwareId}</dd></div>
              <div><dt>Paket</dt><dd>{plan.label} · {plan.ram} GB</dd></div>
              <div><dt>Depolama</dt><dd>{plan.storage} GB</dd></div>
              <div><dt>Bölge</dt><dd>{region.name}</dd></div>
              <div><dt>Kuruldu</dt><dd>{formatMoment(active.createdAt)}</dd></div>
            </dl>
          </section>

          <ServerHistory serverId={active.serverId} updatedAt={active.updatedAt} />

          <ConsoleCard
            gameId={active.gameId}
            online={active.status === "online"}
            serverId={active.serverId}
          />

          <AssistantCard onApplied={(message) => { setToast(message); void onRefresh(); }} />

          <ScheduleCard
            onSaved={(message) => { setToast(message); void onRefresh(); }}
            schedule={active.schedule ?? null}
            serverId={active.serverId}
          />

          <ServerSettingsCard
            busyReason={active.busyWith
              ? "Sunucuda bekleyen bir işlem var; bitince ayarlar yeniden açılır."
              : "Ayarlar yalnızca çalışan veya durdurulmuş sunucuda değiştirilebilir."}
            editable={active.canEditSettings}
            fields={active.settingFields ?? []}
            onSaved={(message) => { setToast(message); void onRefresh(); }}
            serverId={active.serverId}
            values={active.settings ?? {}}
          />

          <section className="panelNotice">
            <Icon name="terminal" size={18} />
            <p>
              <b>Yedekleme ve kaynak grafikleri bu sunucuda henüz yok.</b>
              Kurulmadıkları için panelde gösterilmiyorlar. Konsol, ayarlar ve
              yaşam döngüsü işlemleri yukarıdaki bölümlerde.
            </p>
          </section>
        </div>
      </section>

      {toast && <div className="panelToast" role="status"><Icon name="check" size={17} /> {toast}</div>}
    </div>
  );
}

/** The server's own history, in the wording the customer was given at the time. */
function ServerHistory({ serverId, updatedAt }: { serverId: string; updatedAt: string }) {
  const [events, setEvents] = useState<{ kind: string; message: string; occurredAt: string }[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/servers?serverId=${encodeURIComponent(serverId)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("okunamadı"))))
      .then((body) => { setEvents(body.events ?? []); setFailed(false); })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
    // `updatedAt` changes whenever the worker touches the server, which is
    // exactly when there is a new event to show.
  }, [serverId, updatedAt]);

  return (
    <section className="activityCard">
      <header><small>SUNUCU GEÇMİŞİ</small></header>
      {failed && <p className="historyEmpty">Geçmiş şu anda okunamadı.</p>}
      {!failed && events.length === 0 && <p className="historyEmpty">Henüz kayıt yok.</p>}
      {events.length > 0 && (
        <ul>
          {events.slice(0, 6).map((event) => (
            <li key={`${event.occurredAt}-${event.kind}`}>
              <span className={event.kind.includes("succeeded") ? "good" : ""}>
                <Icon name={event.kind.includes("dead") ? "shield" : "clock"} size={13} />
              </span>
              <p><b>{event.message}</b><small>{formatMoment(event.occurredAt)}</small></p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
