"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../_components/icon";

type Backup = {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string | null;
  sizeMb: number;
};

type BackupView = {
  available: boolean;
  backups?: Backup[];
  limit?: number;
  canCreate?: boolean;
};

function formatMoment(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

function formatSize(megabytes: number) {
  return megabytes >= 1024 ? `${(megabytes / 1024).toFixed(1)} GB` : `${megabytes} MB`;
}

/**
 * Manual world backups.
 *
 * Restoring is deliberately absent: it overwrites a live world, so it needs a
 * confirmation flow of its own rather than a button next to "delete". What is
 * here is the safe half — take a snapshot, see what you have, remove one you no
 * longer want.
 */
export function BackupCard({ serverId, onQueued }: { serverId: string; onQueued: (message: string) => void }) {
  const [view, setView] = useState<BackupView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchBackups = useCallback(async (): Promise<BackupView | null> => {
    try {
      const response = await fetch(`/api/servers?serverId=${encodeURIComponent(serverId)}&view=backups`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      return response.ok ? await response.json() as BackupView : null;
    } catch {
      return null;
    }
  }, [serverId]);

  useEffect(() => {
    let active = true;
    void fetchBackups().then((next) => { if (active && next) setView(next); });
    return () => { active = false; };
  }, [fetchBackups]);

  async function act(body: Record<string, unknown>, marker: string) {
    setBusy(marker);
    setError(null);
    try {
      const response = await fetch("/api/servers", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ serverId, ...body }),
      });
      const payload = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "İşlem tamamlanamadı.");
      onQueued(payload.message ?? "İşlem tamamlandı.");
      const next = await fetchBackups();
      if (next) setView(next);
    } catch (actError) {
      setError(actError instanceof Error ? actError.message : "İşlem tamamlanamadı.");
    } finally {
      setBusy(null);
    }
  }

  if (view && !view.available) {
    return (
      <section className="panelNotice">
        <Icon name="database" size={18} />
        <p><b>Yedekleme bu ortamda kapalı.</b> Sağlayıcı disk yedeği erişimi tanımlanmadığı için gösterilmiyor.</p>
      </section>
    );
  }

  const backups = view?.backups ?? [];

  return (
    <section className="backupCard">
      <header>
        <span><Icon name="database" size={18} /> Yedekler</span>
        <em>{backups.length} / {view?.limit ?? "—"}</em>
      </header>

      <div className="backupList">
        {backups.length === 0 && (
          <p className="backupHint">
            Henüz yedek yok. Yedek alırken dünya diske yazılır ve kısa süre sabitlenir; sunucu kapanmaz.
          </p>
        )}
        {backups.map((item) => (
          <article key={item.id}>
            <div>
              <b>{formatMoment(item.createdAt)}</b>
              <small>{formatSize(item.sizeMb)}{item.expiresAt && ` · ${formatMoment(item.expiresAt)} tarihinde silinir`}</small>
            </div>
            <button
              className="backupDelete"
              disabled={busy !== null}
              onClick={() => {
                if (!globalThis.confirm("Bu yedek kalıcı olarak silinsin mi?")) return;
                void act({ action: "delete_backup", backupId: item.id }, item.id);
              }}
              type="button"
            >
              {busy === item.id ? "Siliniyor…" : "Sil"}
            </button>
          </article>
        ))}
      </div>

      {error && <p className="settingsError" role="alert">{error}</p>}

      <footer>
        <button
          disabled={busy !== null || view?.canCreate === false}
          onClick={() => { void act({ action: "create_backup" }, "create"); }}
          type="button"
        >
          <Icon name="plus" size={15} /> {busy === "create" ? "Sıraya alınıyor…" : "Yedek al"}
        </button>
        <p>
          {view?.canCreate === false && backups.length >= (view.limit ?? 0)
            ? "Yedek sınırına ulaşıldı; yeni yedek için birini sil."
            : "Geri yükleme panelde yok: mevcut dünyanın üzerine yazdığı için ayrı bir onay akışı gerekiyor."}
        </p>
      </footer>
    </section>
  );
}
