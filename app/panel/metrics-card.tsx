"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../_components/icon";

type Point = { at: string; value: number };

type MetricsView = {
  available: boolean;
  window?: { from: string; to: string };
  cpu?: Point[];
  memoryGb?: Point[];
  planMemoryGb?: number;
  heapMemoryGb?: number;
  players?: { online: number; max: number; names: string[] } | null;
  overPlan?: boolean;
};

/**
 * A sparkline drawn from the samples themselves.
 *
 * No chart library: one path over a fixed viewBox is enough for an hour of
 * five-minute samples, and it keeps the panel's bundle honest.
 */
function Sparkline({ points, ceiling, tone }: { points: Point[]; ceiling: number; tone: "cpu" | "memory" }) {
  if (points.length < 2) return <div className="sparkEmpty">Yeterli ölçüm yok</div>;

  const top = Math.max(ceiling, ...points.map((point) => point.value)) || 1;
  const step = 100 / (points.length - 1);
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${(index * step).toFixed(2)} ${(30 - (point.value / top) * 30).toFixed(2)}`)
    .join(" ");

  return (
    <svg aria-hidden="true" className={`spark ${tone}`} preserveAspectRatio="none" viewBox="0 0 100 30">
      {ceiling > 0 && ceiling <= top && (
        <line className="sparkCeiling" x1="0" x2="100" y1={30 - (ceiling / top) * 30} y2={30 - (ceiling / top) * 30} />
      )}
      <path d={path} />
    </svg>
  );
}

function latest(points: Point[] | undefined) {
  return points?.at(-1)?.value ?? null;
}

/**
 * CPU, memory and players over the last hour.
 *
 * Memory is drawn against the plan the customer bought rather than the
 * container limit the provider happens to allow: the provider hands the
 * container more than the plan sells, and showing that would promise resources
 * we do not sell and cannot guarantee.
 */
export function MetricsCard({ serverId, online }: { serverId: string; online: boolean }) {
  const [view, setView] = useState<MetricsView | null>(null);

  /** Fetches without touching state, so the caller decides what to do with it. */
  const fetchMetrics = useCallback(async (): Promise<MetricsView | null> => {
    try {
      const response = await fetch(`/api/servers?serverId=${encodeURIComponent(serverId)}&view=metrics`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      // Charts are an extra; a failed read simply leaves the card empty.
      return response.ok ? await response.json() as MetricsView : null;
    } catch {
      return null;
    }
  }, [serverId]);

  useEffect(() => {
    let active = true;
    // The guard matters when the customer switches servers mid-request: a late
    // answer for the previous server must not paint over the current one.
    void fetchMetrics().then((next) => { if (active && next) setView(next); });
    return () => { active = false; };
  }, [fetchMetrics]);

  const refresh = () => { void fetchMetrics().then((next) => { if (next) setView(next); }); };

  if (view && !view.available) {
    return (
      <section className="panelNotice">
        <Icon name="activity" size={18} />
        <p><b>Kaynak ölçümleri bu ortamda kapalı.</b> Sağlayıcı metrik erişimi tanımlanmadığı için grafik gösterilmiyor.</p>
      </section>
    );
  }

  const cpuNow = latest(view?.cpu);
  const memoryNow = latest(view?.memoryGb);
  const plan = view?.planMemoryGb ?? 0;

  return (
    <section className="metricsCard">
      <header>
        <span><Icon name="activity" size={18} /> Kaynak kullanımı</span>
        <em>SON 1 SAAT</em>
      </header>

      <div className="metricsGrid">
        <article>
          <small>İŞLEMCI</small>
          <b>{cpuNow === null ? "—" : `${(cpuNow * 100).toFixed(0)}%`}</b>
          <Sparkline ceiling={0} points={view?.cpu ?? []} tone="cpu" />
          <p>Bir vCPU’nun yüzdesi olarak.</p>
        </article>

        <article className={view?.overPlan ? "warn" : ""}>
          <small>BELLEK</small>
          <b>{memoryNow === null ? "—" : `${memoryNow.toFixed(2)} GB`}</b>
          <Sparkline ceiling={plan} points={view?.memoryGb ?? []} tone="memory" />
          <p>
            {plan > 0 ? `${plan} GB paket · ${view?.heapMemoryGb ?? "?"} GB oyun belleği` : "Paket bilgisi yok"}
            {view?.overPlan && <em> · paket sınırının üzerinde</em>}
          </p>
        </article>

        <article>
          <small>OYUNCULAR</small>
          <b>{view?.players ? `${view.players.online} / ${view.players.max}` : online ? "—" : "kapalı"}</b>
          <div className="metricsPlayers">
            {view?.players?.names.length
              ? view.players.names.map((name) => <span key={name}>{name}</span>)
              : <span className="metricsEmpty">{online ? "Şu an kimse bağlı değil" : "Sunucu çalışmıyor"}</span>}
          </div>
        </article>
      </div>

      <footer>
        <button onClick={refresh} type="button">
          <Icon name="refresh" size={14} /> Yenile
        </button>
        <p>Ölçümler beş dakikalık örneklerle sağlayıcıdan okunur; oyuncu listesi sunucunun kendisinden gelir.</p>
      </footer>
    </section>
  );
}
