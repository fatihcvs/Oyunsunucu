"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Icon } from "../_components/icon";
import { AdminRecords } from "./admin-records";
import { AdminTeam } from "./admin-team";
import { SERVER_ACTIONS, type AdminState, type Dashboard, type ServerAction, type UpgradeOption } from "./admin-types";
import {
  AdminSection,
  EmptyRow,
  JOB_LABEL,
  ROLE_LABEL,
  Status,
  formatMoment,
  formatMoney,
  shortId,
} from "./admin-ui";


export function AdminShell() {
  const [state, setState] = useState<AdminState>({ kind: "loading" });
  const dashboard = state.kind === "ready" ? state.dashboard : null;
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [commandingServerId, setCommandingServerId] = useState<string | null>(null);
  const [upgradingServerId, setUpgradingServerId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [customerEmail, setCustomerEmail] = useState("");
  const [serverName, setServerName] = useState("");
  const [gameId, setGameId] = useState("minecraft");
  const [softwareId, setSoftwareId] = useState("paper");
  const [planId, setPlanId] = useState("mini-2");
  const [regionId, setRegionId] = useState("eu-west");
  const [costConfirmed, setCostConfirmed] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionRequestId, setProvisionRequestId] = useState<string | null>(null);

  const selectedGame = dashboard?.catalog.games.find((game) => game.id === gameId) ?? null;
  const selectedSoftware = selectedGame?.software.find((software) => software.id === softwareId) ?? null;
  const selectedPlan = dashboard?.catalog.plans.find((plan) => plan.id === planId) ?? null;
  const selectedRegion = dashboard?.catalog.regions.find((region) => region.id === regionId) ?? null;
  const planIsLargeEnough = Boolean(
    selectedPlan && selectedSoftware && selectedPlan.ramGb * 1_024 >= selectedSoftware.minimumMemoryMb,
  );
  const monthlyEstimate = (selectedPlan?.monthlyPrice ?? 0) + (selectedRegion?.surcharge ?? 0);

  const load = useCallback(
    (query: string) =>
      fetch(`/api/admin?q=${encodeURIComponent(query)}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      })
        .then(async (response): Promise<AdminState> => {
          if (response.status === 401) return { kind: "signed_out" };
          if (response.status === 403) return { kind: "forbidden" };
          if (!response.ok) {
            const body = await response.json().catch(() => ({})) as { message?: string };
            return { kind: "unavailable", message: body.message ?? "Operasyon verisi okunamadı." };
          }
          return { kind: "ready", dashboard: await response.json() as Dashboard };
        })
        .catch((): AdminState => ({ kind: "unavailable", message: "Yönetim paneline şu anda ulaşılamıyor." }))
        .then((nextState) => {
          if (nextState.kind === "ready") setActiveQuery(query);
          setState(nextState);
        }),
    [],
  );

  useEffect(() => { void load(""); }, [load]);

  async function commandServer(serverId: string, command: ServerAction, serverName: string) {
    if (command === "sil" && !globalThis.confirm(
      `${serverName} kalıcı olarak silinsin mi? Yedek sistemi olmadığı için bu işlem geri alınamaz.`,
    )) return;

    setCommandingServerId(`${serverId}:${command}`);
    setToast(null);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ action: "command_server", serverId, command }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? "Komut kuyruğa alınamadı.");
      setToast("Komut kuyruğa alındı; worker sırayla uygulayacak.");
      await load(activeQuery);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Komut kuyruğa alınamadı.");
    } finally {
      setCommandingServerId(null);
    }
  }

  async function changePlan(serverId: string, option: UpgradeOption, serverName: string) {
    const difference = option.monthlyDifference > 0
      ? `Aylık katalog farkı +${option.monthlyDifference} TL.`
      : "Aylık katalog farkı yok.";
    if (!globalThis.confirm(
      `${serverName} sunucusu ${option.label} (${option.ramGb} GB) paketine taşınsın mı?\n\n` +
      `${difference} Kapalı betada tahsilat yapılmaz.\n` +
      "Sunucu yeni kaynakla yeniden başlatılacak; dünya ve bağlantı adresi korunur.",
    )) return;

    setUpgradingServerId(serverId);
    setToast(null);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ action: "change_plan", serverId, planId: option.planId }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? "Paket değiştirilemedi.");
      setToast(body.message ?? "Paket değişikliği kuyruğa alındı.");
      await load(activeQuery);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Paket değiştirilemedi.");
    } finally {
      setUpgradingServerId(null);
    }
  }

  async function retryJob(jobId: string) {
    setRetryingJobId(jobId);
    setToast(null);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ action: "retry_job", jobId }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? "İş yeniden sıraya alınamadı.");
      setToast("İş yeniden kuyruğa alındı.");
      await load(activeQuery);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "İş yeniden sıraya alınamadı.");
    } finally {
      setRetryingJobId(null);
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(search.trim());
  }

  function chooseGame(nextGameId: string) {
    const nextGame = dashboard?.catalog.games.find((game) => game.id === nextGameId);
    const nextSoftware = nextGame?.software.find((software) => software.recommended) ?? nextGame?.software[0];
    setGameId(nextGameId);
    setSoftwareId(nextSoftware?.id ?? "");
    if (nextSoftware && dashboard) {
      const currentPlan = dashboard.catalog.plans.find((plan) => plan.id === planId);
      if (!currentPlan || currentPlan.ramGb * 1_024 < nextSoftware.minimumMemoryMb) {
        setPlanId(dashboard.catalog.plans.find((plan) => plan.ramGb * 1_024 >= nextSoftware.minimumMemoryMb)?.id ?? "");
      }
    }
    setProvisionRequestId(null);
  }

  function chooseSoftware(nextSoftwareId: string) {
    const nextSoftware = selectedGame?.software.find((software) => software.id === nextSoftwareId);
    setSoftwareId(nextSoftwareId);
    if (nextSoftware && dashboard) {
      const currentPlan = dashboard.catalog.plans.find((plan) => plan.id === planId);
      if (!currentPlan || currentPlan.ramGb * 1_024 < nextSoftware.minimumMemoryMb) {
        setPlanId(dashboard.catalog.plans.find((plan) => plan.ramGb * 1_024 >= nextSoftware.minimumMemoryMb)?.id ?? "");
      }
    }
    setProvisionRequestId(null);
  }

  async function provisionServer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dashboard?.capabilities.canProvisionServers || !planIsLargeEnough) return;
    const requestId = provisionRequestId ?? crypto.randomUUID();
    if (!provisionRequestId) setProvisionRequestId(requestId);
    setProvisioning(true);
    setToast(null);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          action: "provision_server",
          requestId,
          customerEmail,
          serverName,
          gameId,
          softwareId,
          planId,
          regionId,
          confirmCost: costConfirmed,
        }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string; serverId?: string };
      if (!response.ok) throw new Error(body.message ?? "Sunucu kurulumu başlatılamadı.");
      setToast(body.message ?? "Sunucu kurulumu kuyruğa alındı.");
      setServerName("");
      setCostConfirmed(false);
      setProvisionRequestId(null);
      await load(activeQuery);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Sunucu kurulumu başlatılamadı.");
    } finally {
      setProvisioning(false);
    }
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSigningIn(true);
    setSignInError(null);
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? "Admin girişi tamamlanamadı.");
      setAdminPassword("");
      setState({ kind: "loading" });
      await load("");
    } catch (error) {
      setSignInError(error instanceof Error ? error.message : "Admin girişi tamamlanamadı.");
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <>
      <header className="adminTopbar">
        <Link className="brand" href="/" aria-label="Riftory ana sayfa">
          <span className="brandIcon"><i /></span><b>RIFTORY</b>
        </Link>
        <span className="adminTopbarMode"><i /> OPERASYON KONSOLU</span>
        <div>
          {dashboard && (
            <span className="adminViewer">
              <b>{dashboard.viewer.displayName}</b>
              <small>{ROLE_LABEL[dashboard.viewer.role]}</small>
            </span>
          )}
          <Link href="/panel">Müşteri paneli <Icon name="arrow" size={15} /></Link>
        </div>
      </header>

      {state.kind === "loading" && (
        <section className="adminGate" role="status">
          <Icon name="activity" size={23} />
          <h1>Operasyon verisi hazırlanıyor</h1>
          <p>Yetki ve veritabanı bağlantısı doğrulanıyor…</p>
        </section>
      )}

      {state.kind === "signed_out" && (
        <section className="adminGate">
          <Icon name="lock" size={25} />
          <small>YETKİLİ ERİŞİM</small>
          <h1>Operasyon hesabıyla giriş yap</h1>
          <p>Parola yalnız doğrulanmış admin hesabı ve açık üyelik kaydıyla oturum üretir.</p>
          <form className="adminLoginForm" onSubmit={signIn}>
            <label htmlFor="admin-email">E-posta</label>
            <input
              autoComplete="username"
              id="admin-email"
              inputMode="email"
              maxLength={254}
              onChange={(event) => setAdminEmail(event.target.value)}
              placeholder="admin@example.com"
              required
              type="email"
              value={adminEmail}
            />
            <label htmlFor="admin-password">Parola</label>
            <input
              autoComplete="current-password"
              id="admin-password"
              maxLength={256}
              onChange={(event) => setAdminPassword(event.target.value)}
              required
              type="password"
              value={adminPassword}
            />
            {signInError && <p className="adminLoginError" role="alert">{signInError}</p>}
            <button disabled={signingIn} type="submit">
              {signingIn ? "Doğrulanıyor…" : "Admin paneline gir"} <Icon name="arrow" size={16} />
            </button>
          </form>
          <Link className="adminLoginFallback" href="/giris?returnTo=/admin">Standart Riftory oturumuyla devam et</Link>
        </section>
      )}

      {state.kind === "forbidden" && (
        <section className="adminGate danger">
          <Icon name="shield" size={25} />
          <small>ERİŞİM REDDEDİLDİ</small>
          <h1>Bu hesap operasyon ekibinde değil</h1>
          <p>Admin erişimi yalnızca veritabanındaki açık üyelik kaydıyla verilir.</p>
          <Link href="/panel">Müşteri paneline dön</Link>
        </section>
      )}

      {state.kind === "unavailable" && (
        <section className="adminGate danger">
          <Icon name="database" size={25} />
          <small>BAĞLANTI SORUNU</small>
          <h1>Yönetim paneli açılamadı</h1>
          <p>{state.message}</p>
          <button onClick={() => { void load(activeQuery); }} type="button">Yeniden dene</button>
        </section>
      )}

      {dashboard && (
        <div className="adminShell">
          <section className="adminHero">
            <div>
              <span><i /> CANLI OPERASYON GÖRÜNÜMÜ</span>
              <h1>Yönetim <em>merkezi.</em></h1>
              <p>Siparişleri ve provisioning kuyruğunu izle; doğrulanmış beta müşterilerine aynı güvenli iş hattından sunucu tahsis et.</p>
            </div>
            <form className="adminSearch" onSubmit={submitSearch}>
              <Icon name="search" size={17} />
              <label htmlFor="admin-search">Sipariş, sunucu veya e-posta ara</label>
              <input
                id="admin-search"
                maxLength={80}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Kimlik, sunucu adı veya e-posta"
                value={search}
              />
              <button type="submit">Ara</button>
              {activeQuery && (
                <button className="clear" onClick={() => { setSearch(""); void load(""); }} type="button">Temizle</button>
              )}
            </form>
          </section>

          <section className="adminProvision" aria-labelledby="admin-provision-title">
            <header>
              <span className="adminProvisionIcon"><Icon name="rocket" size={21} /></span>
              <div>
                <small>MANUEL BETA TAHSİSİ</small>
                <h2 id="admin-provision-title">Yeni sunucu kurulumu</h2>
                <p>Ödeme veya sipariş üretmez; doğrulanmış müşteriye gerçek provider işi kuyruğa alır.</p>
              </div>
              <span className="adminCapacity">
                <b>{dashboard.capacity.activeServers} / {dashboard.capacity.limit}</b>
                <small>aktif kapasite</small>
              </span>
            </header>

            {dashboard.capabilities.canProvisionServers ? (
              <div className="adminProvisionBody">
                <form className="adminProvisionForm" onSubmit={provisionServer}>
                  <label className="wide">
                    <span>Müşteri e-postası</span>
                    <input
                      autoComplete="off"
                      inputMode="email"
                      maxLength={254}
                      onChange={(event) => { setCustomerEmail(event.target.value); setProvisionRequestId(null); }}
                      placeholder="oyuncu@example.com"
                      required
                      type="email"
                      value={customerEmail}
                    />
                    <small>Aktif ve doğrulanmış Riftory hesabı olmalı.</small>
                  </label>
                  <label className="wide">
                    <span>Sunucu adı</span>
                    <input
                      maxLength={60}
                      minLength={3}
                      onChange={(event) => { setServerName(event.target.value); setProvisionRequestId(null); }}
                      placeholder="Topluluk Dünyası"
                      required
                      value={serverName}
                    />
                    <small>Müşteri panelinde ve provider kaydında görünür.</small>
                  </label>
                  <label>
                    <span>Oyun</span>
                    <select onChange={(event) => chooseGame(event.target.value)} value={gameId}>
                      {dashboard.catalog.games.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Yazılım</span>
                    <select onChange={(event) => chooseSoftware(event.target.value)} value={softwareId}>
                      {selectedGame?.software.map((software) => (
                        <option key={software.id} value={software.id}>{software.name}{software.recommended ? " · önerilen" : ""}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Paket</span>
                    <select onChange={(event) => { setPlanId(event.target.value); setProvisionRequestId(null); }} value={planId}>
                      {dashboard.catalog.plans.map((plan) => (
                        <option
                          disabled={Boolean(selectedSoftware && plan.ramGb * 1_024 < selectedSoftware.minimumMemoryMb)}
                          key={plan.id}
                          value={plan.id}
                        >
                          {plan.label} · {plan.ramGb} GB RAM
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Bölge</span>
                    <select onChange={(event) => { setRegionId(event.target.value); setProvisionRequestId(null); }} value={regionId}>
                      {dashboard.catalog.regions.map((region) => (
                        <option key={region.id} value={region.id}>{region.location} · {region.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="adminCostConfirm wide">
                    <input
                      checked={costConfirmed}
                      onChange={(event) => setCostConfirmed(event.target.checked)}
                      required
                      type="checkbox"
                    />
                    <span>
                      <b>Gerçek Railway kaynağı ve aylık maliyet oluşturacağını onaylıyorum.</b>
                      <small>İşlem audit kaydına yazılır; aynı istek kimliği ikinci bir sunucu oluşturmaz.</small>
                    </span>
                  </label>
                  <button
                    className="adminProvisionSubmit"
                    disabled={provisioning || !costConfirmed || !planIsLargeEnough || dashboard.capacity.activeServers >= dashboard.capacity.limit}
                    type="submit"
                  >
                    <Icon name="rocket" size={16} /> {provisioning ? "Kuyruğa alınıyor…" : "Kurulumu başlat"}
                  </button>
                </form>

                <aside className="adminProvisionSummary">
                  <small>TAHSİS ÖZETİ</small>
                  <h3>{serverName.trim() || "Yeni Riftory sunucusu"}</h3>
                  <dl>
                    <div><dt>Oyun</dt><dd>{selectedGame?.name ?? "—"}</dd></div>
                    <div><dt>Runtime</dt><dd>{selectedSoftware?.name ?? "—"}</dd></div>
                    <div><dt>Kaynak</dt><dd>{selectedPlan ? `${selectedPlan.ramGb} GB RAM · ${selectedPlan.storageGb} GB disk` : "—"}</dd></div>
                    <div><dt>Bölge</dt><dd>{selectedRegion?.location ?? "—"}</dd></div>
                    <div><dt>Tahmini katalog</dt><dd>{formatMoney(monthlyEstimate * 100, "TRY")} / ay</dd></div>
                  </dl>
                  {!planIsLargeEnough && <p className="adminProvisionWarning">Bu runtime için daha büyük bir paket seçin.</p>}
                  <p><Icon name="shield" size={14} /> Provider anahtarı tarayıcıya gönderilmez; worker işi kuyruktan alır.</p>
                </aside>
              </div>
            ) : (
              <p className="adminProvisionReadonly"><Icon name="lock" size={15} /> Destek rolü kurulumları izleyebilir ancak yeni kaynak oluşturamaz.</p>
            )}
          </section>

          <section aria-label="Operasyon özeti" className="adminMetrics">
            <Metric icon="users" label="Kullanıcılar" value={dashboard.metrics.users.total} detail={`${dashboard.metrics.users.active} aktif · son 24 saatte ${dashboard.metrics.users.createdLast24Hours}`} />
            <Metric icon="wallet" label="Siparişler" value={dashboard.metrics.orders.total} detail={`${dashboard.metrics.orders.pendingPayment} ödeme bekliyor · ${dashboard.metrics.orders.paidOrActive} ödendi/aktif`} />
            <Metric icon="server" label="Sunucular" value={dashboard.metrics.servers.total} detail={`${dashboard.metrics.servers.online} çevrimiçi · ${dashboard.metrics.servers.provisioning} kuruluyor · limit ${dashboard.capacity.limit}`} alert={dashboard.metrics.servers.failed} />
            <Metric icon="activity" label="İş kuyruğu" value={dashboard.metrics.jobs.queued + dashboard.metrics.jobs.leased} detail={`${dashboard.metrics.jobs.queued} sırada · ${dashboard.metrics.jobs.leased} işleniyor`} alert={dashboard.metrics.jobs.dead} />
          </section>

          <AdminSection count={dashboard.orders.length} icon="wallet" title="Son siparişler">
            <div className="adminTableWrap">
              <table className="adminTable">
                <thead><tr><th>Sipariş</th><th>Müşteri</th><th>Durum</th><th>Tutar</th><th>Oluşturuldu</th></tr></thead>
                <tbody>
                  {dashboard.orders.map((order) => (
                    <tr key={order.orderId}>
                      <td><code title={order.orderId}>{shortId(order.orderId)}</code></td>
                      <td><b>{order.customerName}</b><small>{order.customerEmail}</small></td>
                      <td><Status value={order.status} /></td>
                      <td>{formatMoney(order.totalMinor, order.currency)}</td>
                      <td>{formatMoment(order.createdAt)}</td>
                    </tr>
                  ))}
                  {dashboard.orders.length === 0 && <EmptyRow columns={5} />}
                </tbody>
              </table>
            </div>
          </AdminSection>

          <AdminSection count={dashboard.servers.length} icon="server" title="Müşteri sunucuları">
            <div className="adminTableWrap">
              <table className="adminTable">
                <thead><tr><th>Sunucu</th><th>Müşteri</th><th>Oyun / runtime</th><th>Paket / bölge</th><th>Kaynak</th><th>Durum</th><th>Bağlantı</th><th>İşlem</th></tr></thead>
                <tbody>
                  {dashboard.servers.map((server) => (
                    <tr key={server.serverId}>
                      <td><b>{server.name}</b><code title={server.serverId}>{shortId(server.serverId)}</code></td>
                      <td>{server.customerEmail}</td>
                      <td><b>{server.gameId}</b><small>{server.softwareId}</small></td>
                      <td>
                        <b>{server.planId}</b>
                        <small>{server.regionId}</small>
                        <PlanUpgrade
                          busy={upgradingServerId === server.serverId}
                          canChange={dashboard.capabilities.canChangePlans && !server.pendingJobKind}
                          onUpgrade={(option) => { void changePlan(server.serverId, option, server.name); }}
                          options={dashboard.upgrades?.[server.serverId] ?? []}
                        />
                      </td>
                      <td><span className="adminSource">{server.source === "manual" ? "Manuel beta" : "Sipariş"}</span><small>{formatMoment(server.createdAt)}</small></td>
                      <td><Status value={server.status} />{server.pendingJobKind && <small>{JOB_LABEL[server.pendingJobKind] ?? server.pendingJobKind}</small>}</td>
                      <td>
                        <code>{server.connection ? `${server.connection.host}:${server.connection.port}` : "—"}</code>
                        <small>{formatMoment(server.updatedAt)}</small>
                      </td>
                      <td>
                        <ServerActions
                          busyKey={commandingServerId}
                          capabilities={dashboard.capabilities}
                          onCommand={(command) => { void commandServer(server.serverId, command, server.name); }}
                          server={server}
                        />
                      </td>
                    </tr>
                  ))}
                  {dashboard.servers.length === 0 && <EmptyRow columns={8} />}
                </tbody>
              </table>
            </div>
          </AdminSection>

          <AdminSection count={dashboard.jobs.length} icon="activity" title="Provisioning işleri">
            <div className="adminTableWrap">
              <table className="adminTable jobs">
                <thead><tr><th>İş</th><th>Sunucu</th><th>Tür</th><th>Durum</th><th>Deneme</th><th>Operatör detayı</th><th>İşlem</th></tr></thead>
                <tbody>
                  {dashboard.jobs.map((job) => {
                    const retryable = job.status === "dead" || job.status === "failed";
                    return (
                      <tr key={job.jobId}>
                        <td><code title={job.jobId}>{shortId(job.jobId)}</code><small>{formatMoment(job.updatedAt)}</small></td>
                        <td><b>{job.serverName ?? "Sunucusuz iş"}</b><small>{job.customerEmail ?? job.serverId ?? "—"}</small></td>
                        <td>{JOB_LABEL[job.kind] ?? job.kind}</td>
                        <td><Status value={job.status} /></td>
                        <td>{job.attempts} / {job.maxAttempts}</td>
                        <td><span className="adminJobError" title={job.lastError ?? undefined}>{job.lastError ?? "—"}</span></td>
                        <td>
                          {retryable && dashboard.capabilities.canRetryJobs ? (
                            <button
                              className="adminRetry"
                              disabled={retryingJobId === job.jobId}
                              onClick={() => { void retryJob(job.jobId); }}
                              type="button"
                            >
                              <Icon name="refresh" size={13} /> {retryingJobId === job.jobId ? "Kuyruklanıyor" : "Yeniden dene"}
                            </button>
                          ) : <span className="adminNoAction">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {dashboard.jobs.length === 0 && <EmptyRow columns={7} />}
                </tbody>
              </table>
            </div>
          </AdminSection>

          <AdminRecords
            dashboard={dashboard}
            onChanged={() => load(activeQuery)}
            onToast={setToast}
          />

          <AdminTeam
            dashboard={dashboard}
            onChanged={() => load(activeQuery)}
            onToast={setToast}
          />

          <footer className="adminFootnote">
            <span><Icon name="shield" size={15} /> Rol: {ROLE_LABEL[dashboard.viewer.role]}</span>
            <span>Son okuma: {formatMoment(dashboard.generatedAt)}</span>
            <p>Ödeme iadesi ve abonelik değişiklikleri konsolda yoktur; para hareketi ayrı bir onay akışı gerektirir.</p>
          </footer>
        </div>
      )}

      {toast && <div className="panelToast" role="status"><Icon name="check" size={17} /> {toast}</div>}
    </>
  );
}

function Metric({ icon, label, value, detail, alert = 0 }: {
  icon: "users" | "wallet" | "server" | "activity";
  label: string;
  value: number;
  detail: string;
  alert?: number;
}) {
  return (
    <article>
      <span><Icon name={icon} size={18} /></span>
      <small>{label}</small>
      <b>{value}</b>
      <p>{detail}</p>
      {alert > 0 && <em>{alert} müdahale</em>}
    </article>
  );
}


/**
 * The commands this server's state can actually carry out.
 *
 * Buttons the state cannot serve are not rendered at all rather than rendered
 * disabled: an operator should read the row and know what is possible, not
 * hunt for why a button does nothing.
 */
function ServerActions({ busyKey, capabilities, onCommand, server }: {
  busyKey: string | null;
  capabilities: Dashboard["capabilities"];
  onCommand: (command: ServerAction) => void;
  server: Dashboard["servers"][number];
}) {
  if (!capabilities.canCommandServers) return <span className="adminNoAction">—</span>;
  if (server.pendingJobKind) {
    return <span className="adminNoAction">{JOB_LABEL[server.pendingJobKind] ?? server.pendingJobKind} sürüyor</span>;
  }

  const available = SERVER_ACTIONS.filter((action) =>
    action.statuses.includes(server.status as never) &&
    (!action.ownerOnly || capabilities.canDeleteServers));
  if (available.length === 0) return <span className="adminNoAction">—</span>;

  return (
    <div className="adminRowActions">
      {available.map((action) => (
        <button
          className={action.command === "sil" ? "adminRetry danger" : "adminRetry"}
          disabled={busyKey === `${server.serverId}:${action.command}`}
          key={action.command}
          onClick={() => onCommand(action.command)}
          type="button"
        >
          {busyKey === `${server.serverId}:${action.command}` ? "Kuyruklanıyor" : action.label}
        </button>
      ))}
    </div>
  );
}


/**
 * The plans this server may move up to, with what each costs per month.
 *
 * Downgrades are absent because the catalogue refuses them: a smaller plan
 * carries a smaller disk, and a live world cannot be moved onto one safely.
 */
function PlanUpgrade({ busy, canChange, onUpgrade, options }: {
  busy: boolean;
  canChange: boolean;
  onUpgrade: (option: UpgradeOption) => void;
  options: UpgradeOption[];
}) {
  if (!canChange || options.length === 0) return null;

  return (
    <select
      className="adminPlanPicker"
      disabled={busy}
      onChange={(event) => {
        const option = options.find((candidate) => candidate.planId === event.target.value);
        event.target.value = "";
        if (option) onUpgrade(option);
      }}
      value=""
    >
      <option value="">{busy ? "Kuyruklanıyor…" : "Paketi yükselt…"}</option>
      {options.map((option) => (
        <option key={option.planId} value={option.planId}>
          {option.label} · {option.ramGb} GB · +{option.monthlyDifference} TL/ay
        </option>
      ))}
    </select>
  );
}
