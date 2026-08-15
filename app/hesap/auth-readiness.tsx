"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "../_components/icon";

type RuntimeStatus = {
  live: boolean;
  checks: {
    database: boolean;
    sessionSecret: boolean;
    emailDelivery: boolean;
    discordOAuth: boolean;
    postgresAdapter: boolean;
  };
};

type ReadinessRow = {
  icon: IconName;
  title: string;
  text: string;
  state: string;
  ready: boolean;
};

const implementedRows: ReadinessRow[] = [
  {
    icon: "lock",
    title: "Oturum güvenliği",
    text: "256 bit belirteç, SHA-256 özet, güvenli çerez ve iptal kuralları.",
    state: "TEST EDİLDİ",
    ready: true,
  },
  {
    icon: "database",
    title: "PostgreSQL deposu",
    text: "Parametreli SQL, transaction ve sağlayıcıdan bağımsız bağlantı sınırı.",
    state: "KOD HAZIR",
    ready: true,
  },
  {
    icon: "shield",
    title: "Magic-link zinciri",
    text: "10 dakikalık tek kullanım, HMAC oran limiti ve atomik oturum üretimi.",
    state: "SERVİS HAZIR",
    ready: true,
  },
  {
    icon: "server",
    title: "Taslak aktarımı",
    text: "Cihaz planı payload özeti ve import anahtarıyla yalnızca bir kez taşınır.",
    state: "TRANSACTION HAZIR",
    ready: true,
  },
];

const waitingRuntimeRows: ReadinessRow[] = [
  {
    icon: "database",
    title: "Railway çalışma ortamı",
    text: "DATABASE_URL ve 32+ bayt oturum sırrı yayın servisine bağlanacak.",
    state: "YAPILANDIRMA BEKLİYOR",
    ready: false,
  },
  {
    icon: "users",
    title: "Canlı kimlik sağlayıcısı",
    text: "E-posta veya Discord anahtarları ve PostgreSQL sürücü adaptörü etkinleşecek.",
    state: "SAĞLAYICI BEKLİYOR",
    ready: false,
  },
];

export function AuthReadiness() {
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/status", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((value: RuntimeStatus | null) => setRuntime(value))
      .catch(() => setRuntime(null));
    return () => controller.abort();
  }, []);

  const rows = useMemo(() => {
    if (!runtime) return [...implementedRows, ...waitingRuntimeRows];
    const runtimeConfigured = runtime.checks.database && runtime.checks.sessionSecret;
    const providerConfigured = runtime.checks.emailDelivery || runtime.checks.discordOAuth;
    return [
      ...implementedRows,
      {
        ...waitingRuntimeRows[0],
        ready: runtimeConfigured,
        state: runtimeConfigured ? "ORTAM HAZIR" : "YAPILANDIRMA BEKLİYOR",
      },
      {
        ...waitingRuntimeRows[1],
        ready: runtime.live,
        state: runtime.live
          ? "CANLI"
          : providerConfigured && !runtime.checks.postgresAdapter
            ? "ADAPTÖR BEKLİYOR"
            : "SAĞLAYICI BEKLİYOR",
      },
    ];
  }, [runtime]);
  const readyCount = rows.filter((row) => row.ready).length;

  return (
    <section className="accountReadiness" aria-labelledby="security-heading">
      <header>
        <div><small>GÜVENLİK HAZIRLIK DURUMU</small><h2 id="security-heading">Kimlik zinciri</h2></div>
        <span><i /> {readyCount} / {rows.length} kapı hazır</span>
      </header>
      <div className="accountSecurityGrid">
        {rows.map((row) => (
          <article className={row.ready ? "ready" : "pending"} key={row.title}>
            <span><Icon name={row.icon} size={20} /></span>
            <div><h3>{row.title}</h3><p>{row.text}</p></div>
            <em><i /> {row.state}</em>
          </article>
        ))}
      </div>
    </section>
  );
}
