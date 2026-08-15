"use client";

import type { CSSProperties, FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "./_components/icon";
import {
  BACKUP_MONTHLY_PRICE,
  CONFIGURATOR_STORAGE_KEY,
  DEFAULT_SERVER_DRAFT,
  GAME_CATALOG,
  HOSTING_PLANS,
  type ActiveGameId,
} from "@/lib/catalog";
import { absoluteUrl, GAME_LANDING_PATHS, serializeJsonLd, SITE_DESCRIPTION } from "@/lib/seo";

const games = GAME_CATALOG;
const plans = HOSTING_PLANS;

const questions = [
  ["Oyun sunucusu kiralama beta sürecinde nasıl çalışacak?", "Minecraft Java veya Terraria planını, RAM miktarını, bölgeyi ve yedekleme seçeneğini yapılandırıcıda belirlersin. Canlı satış açıldığında ödeme onayından sonra kurulum otomasyonu başlayacak; bugünkü sürüm ödeme almaz ve gerçek sunucu oluşturmaz."],
  ["Minecraft için Paper, Vanilla veya Fabric seçebilir miyim?", "Evet. Paper eklenti odaklı, Vanilla sade, Fabric ise hafif modlu kurulumlar için planlanıyor. Gerçek sürüm ve uyumluluk listesi beta testleri tamamlandıkça yayınlanacak."],
  ["Terraria sunucusunda tModLoader desteği olacak mı?", "Vanilla ilk beta kapsamındadır. tModLoader; mod uyumluluğu, güncelleme ve yedekten dönüş testlerinden sonra kontrollü beta olarak açılacak."],
  ["Sunucu paketini daha sonra yükseltebilir miyim?", "Kaynak yükseltmelerinin dünya dosyalarını koruması ve riskli işlemlerden önce yedek alınması planlanıyor. Bu davranış gerçek oyun testleri geçmeden garanti olarak sunulmayacak."],
  ["FiveM ve Rust neden henüz yok?", "Bu oyunlar dışarıdan UDP bağlantısı gerektiriyor. İlk Railway altyapısı TCP odaklı olduğu için yalnızca güvenilir biçimde çalıştırabildiğimiz oyunlarla başlayıp UDP ağı hazır olduğunda kataloğu genişleteceğiz."],
];

const homeJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${absoluteUrl("/")}#organization`,
      name: "Riftory",
      url: absoluteUrl("/"),
      description: SITE_DESCRIPTION,
    },
    {
      "@type": "WebSite",
      "@id": `${absoluteUrl("/")}#website`,
      name: "Riftory",
      url: absoluteUrl("/"),
      description: SITE_DESCRIPTION,
      inLanguage: "tr-TR",
      publisher: { "@id": `${absoluteUrl("/")}#organization` },
    },
  ],
};

export default function Home() {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [game, setGame] = useState("minecraft");
  const [ram, setRam] = useState(4);
  const [backup, setBackup] = useState(true);
  const [region] = useState("Avrupa Batı");
  const [faq, setFaq] = useState<number | null>(0);
  const [modal, setModal] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const plan = useMemo(() => plans.find((item) => item.ram === ram) ?? plans[1], [ram]);
  const total = plan.price + (backup ? BACKUP_MONTHLY_PRICE : 0);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModal(false);
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", key);
    document.body.style.overflow = modal ? "hidden" : "";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = "";
    };
  }, [modal]);

  const configure = () => {
    setMenuOpen(false);
    router.push("/kurulum");
  };
  const configurePlan = (selectedGame: ActiveGameId = game as ActiveGameId) => {
    const selectedPlan = plans.find((item) => item.ram === ram) ?? plans[1];
    const nextDraft = {
      ...DEFAULT_SERVER_DRAFT,
      gameId: selectedGame,
      softwareId: selectedGame === "minecraft" ? "paper" : "terraria-vanilla",
      planId: selectedPlan.id,
      backups: backup,
    };
    window.localStorage.setItem(CONFIGURATOR_STORAGE_KEY, JSON.stringify(nextDraft));
    router.push("/kurulum");
  };
  const reserve = () => {
    setSent(false);
    setModal(true);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSent(true);
  };
  const copyAddress = async () => {
    await navigator.clipboard?.writeText("play.riftory.com");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <main>
      <script dangerouslySetInnerHTML={{ __html: serializeJsonLd(homeJsonLd) }} type="application/ld+json" />
      <div className="noise" aria-hidden="true" />
      <header className="header">
        <a className="brand" href="#top" aria-label="Riftory ana sayfa"><span className="brandIcon"><i /></span><b>RIFTORY</b></a>
        <nav className="desktopNav" aria-label="Ana menü">
          <a href="#oyunlar">Oyunlar</a><a href="#kurulum">Paketler</a><a href="#panel">Özellikler</a><a href="#sss">Destek</a>
        </nav>
        <div className="headerActions">
          <button className="login" onClick={() => router.push("/giris")} type="button">Giriş yap</button>
          <button className="button small" onClick={configure} type="button">Sunucu kur <Icon name="arrow" size={17} /></button>
          <button aria-expanded={menuOpen} aria-label="Menüyü aç veya kapat" className="menuButton" onClick={() => setMenuOpen(!menuOpen)} type="button"><Icon name={menuOpen ? "close" : "menu"} /></button>
        </div>
        {menuOpen && (
          <nav className="mobileNav" aria-label="Mobil menü">
            <a href="#oyunlar" onClick={() => setMenuOpen(false)}>Oyunlar</a>
            <a href="#kurulum" onClick={() => setMenuOpen(false)}>Paketler</a>
            <a href="#panel" onClick={() => setMenuOpen(false)}>Özellikler</a>
            <a href="#sss" onClick={() => setMenuOpen(false)}>Destek</a>
            <button className="login" onClick={() => router.push("/giris")} type="button">Giriş yap</button>
            <button className="button" onClick={configure} type="button">Sunucu kur <Icon name="arrow" size={17} /></button>
          </nav>
        )}
      </header>

      <section className="hero" id="top">
        <div className="heroCopy">
          <span className="eyebrow"><i /> Minecraft & Terraria · Kapalı beta</span>
          <h1>Oyun sunucunu kur, <em>kurulumla uğraşma.</em></h1>
          <p>Minecraft Java veya Terraria için oyun sunucusu planını oluştur. Yazılımı, RAM’i ve yedeklemeyi tek ekranda seç; dünyanı sade Türkçe panelden yönet.</p>
          <div className="heroButtons">
            <button className="button large" onClick={configure} type="button">Sunucunu yapılandır <Icon name="arrow" /></button>
            <a className="ghost" href="#nasil"><span><Icon name="play" size={15} /></span>Nasıl çalışır?</a>
          </div>
          <div className="heroProof">
            <div><Icon name="bolt" /><span><b>Adım adım planlama</b><small>Hazır oyun şablonları</small></span></div>
            <div><Icon name="shield" /><span><b>Şeffaf beta</b><small>Gerçek dışı vaat yok</small></span></div>
            <div><Icon name="headset" /><span><b>Türkçe deneyim</b><small>Sade panel ve açıklamalar</small></span></div>
          </div>
        </div>

        <div className="heroVisual" aria-label="Sunucu paneli ön izlemesi">
          <div className="orbit one" /><div className="orbit two" />
          <div className="serverCard">
            <div className="serverHead">
              <div><span className="gameBadge">M</span><span><small>MINECRAFT JAVA · PANEL ÖN İZLEME</small><b>Fatih&apos;in Dünyası</b></span></div>
              <em><i /> Çevrimiçi</em>
            </div>
            <div className="address">
              <span><small>ÖRNEK SUNUCU ADRESİ</small><b>play.riftory.com</b></span>
              <button aria-label="Sunucu adresini kopyala" onClick={copyAddress} type="button"><Icon name={copied ? "check" : "copy"} size={17} /></button>
            </div>
            <div className="metrics">
              <Metric icon="cpu" label="CPU" value="%18" fill="18%" />
              <Metric icon="database" label="RAM" value="2.1 / 4 GB" fill="53%" />
              <Metric icon="users" label="OYUNCU" value="7 / 15" fill="47%" />
              <Metric icon="clock" label="ÇALIŞMA" value="6g 14sa" fill="86%" />
            </div>
            <div className="console">
              <header><span><i /><i /><i /></span><small>CANLI KONSOL</small><em>● LIVE</em></header>
              <div>
                <p><span>20:41:02</span> [Server thread/INFO]: Starting Minecraft server</p>
                <p><span>20:41:03</span> [Server thread/INFO]: Preparing spawn area: 100%</p>
                <p><span>20:41:04</span> [Server thread/INFO]: <b>Done! Type &quot;help&quot; for help</b></p>
                <p><span>20:41:18</span> [Server thread/INFO]: thepublisher joined the game</p>
              </div>
            </div>
            <div className="serverButtons"><button type="button"><Icon name="play" size={14} /> Başlat</button><button type="button">↻ Yeniden başlat</button><button type="button"><i /> Durdur</button></div>
          </div>
          <div className="floatChip location"><Icon name="globe" size={17} /><span><small>İLK BETA BÖLGESİ</small><b>EU West · Amsterdam</b></span></div>
          <div className="floatChip backup"><Icon name="shield" size={17} /><span><small>SON YEDEK</small><b>2 dk önce</b></span><Icon name="check" size={14} /></div>
        </div>
      </section>

      <div className="trust"><span>NVMe paketleri</span><i /> <span>Günlük yedek seçeneği</span><i /> <span>Esnek kaynak planları</span><i /> <span>Türkçe kontrol paneli</span></div>

      <section className="section games" id="oyunlar">
        <SectionTitle kicker="Oyun sunucusu kataloğu" icon="gamepad" title={<>Hangi dünyayı<br />kuruyoruz?</>} text="Minecraft sunucu kiralama deneyimiyle başlıyor, Terraria kontrollü betasıyla devam ediyoruz. Teknik olarak doğrulamadığımız oyunu satışa açmıyoruz." />
        <div className="gameGrid">
          {games.map((item) => (
            <article className={"gameCard " + (!item.live ? "soon" : "")} key={item.id}>
              <div className="gameArt" style={{ "--game": item.color } as CSSProperties}><b>{item.letter}</b><span className={item.live ? "live" : ""}><i /> {item.tag}</span></div>
              <div className="gameInfo"><div><h3>{item.name}</h3><p>{item.desc}</p>{item.live && <a href={GAME_LANDING_PATHS[item.id as ActiveGameId]}>{item.name} sunucusunu incele</a>}</div>{item.live ? <button aria-label={item.name + " sunucusu kur"} onClick={() => configurePlan(item.id as ActiveGameId)} type="button"><Icon name="arrow" /></button> : <small>Haber ver</small>}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="section builder" id="kurulum">
        <div className="builderShell">
          <div className="builderIntro">
            <Kicker icon="spark">Sunucu oluşturucu</Kicker>
            <h2>Oyun sunucusu paketini<br />adım adım hazırla.</h2>
            <p>Oyuncu sayına göre RAM ve NVMe depolamayı karşılaştır. Fiyatı seçerken gör; ihtiyacın değiştiğinde yükseltme planını panelden yönet.</p>
            <div className="betaNote"><Icon name="shield" /><span><b>Beta güvencesi</b><small>Ödeme alınmadan önce nihai fiyat ve sunucu lokasyonu açıkça gösterilecek.</small></span></div>
          </div>
          <div className="builderCard">
            <div className="steps"><span className="active"><i>1</i> Oyun</span><b /><span className="active"><i>2</i> Paket</span><b /><span><i>3</i> Özet</span></div>
            <Field label="Oyununu seç">
              <div className="gameChoices">
                <Choice selected={game === "minecraft"} onClick={() => setGame("minecraft")} badge="M" title="Minecraft Java" sub="Hazır" />
                <Choice selected={game === "terraria"} onClick={() => setGame("terraria")} badge="T" title="Terraria" sub="Beta" blue />
              </div>
            </Field>
            <Field label="RAM seçimi" note={plan.players}>
              <div className="ramChoices">{plans.map((item) => <button className={ram === item.ram ? "selected" : ""} key={item.ram} onClick={() => setRam(item.ram)} type="button"><b>{item.ram} GB</b><small>{item.label}</small></button>)}</div>
            </Field>
            <div className="splitFields">
              <Field label="Lokasyon"><button className="selectCard" disabled type="button"><span>🇪🇺</span><b>{region} · Amsterdam</b><em>✓</em></button></Field>
              <Field label="Günlük yedek"><button aria-checked={backup} className={"toggleCard " + (backup ? "on" : "")} onClick={() => setBackup(!backup)} role="switch" type="button"><span><b>{backup ? "Aktif" : "Kapalı"}</b><small>+49 TL / ay</small></span><i><b /></i></button></Field>
            </div>
            <div className="price"><span><small>TAHMİNİ AYLIK</small><b>{total.toLocaleString("tr-TR")} TL <em>/ ay</em></b><i>KDV dahil beta fiyatı</i></span><button className="button large" onClick={() => configurePlan()} type="button">Tam yapılandırıcı <Icon name="arrow" /></button></div>
          </div>
        </div>
      </section>

      <section className="section process" id="nasil">
        <div className="centerTitle"><Kicker icon="rocket">Karmaşa yok</Kicker><h2>Üç adım. Sonra oyun.</h2><p>Oyununu seç, kaynaklarını belirle ve bağlantı bilgilerini panelden al. Dosya, port ve komut satırı ayrıntıları yönetim akışının dışında kalsın.</p></div>
        <div className="processGrid">
          <Step no="01" icon="gamepad" title="Oyununu seç">Desteklenen oyun ve sürümü seç. Modlu ya da sade kurulumuna karar ver.</Step>
          <Step no="02" icon="server" title="Kaynaklarını belirle">Oyuncu sayına uygun RAM, lokasyon ve yedekleme seçeneklerini ayarla.</Step>
          <Step no="03" icon="bolt" title="Bağlan ve oyna">Panelde oluşan sunucu adresini ekibinle paylaş. Yönetim hep elinin altında.</Step>
        </div>
      </section>

      <section className="section panelSection" id="panel">
        <div className="panelShell">
          <div className="panelCopy">
            <Kicker icon="shield">Kontrol sende</Kicker>
            <h2>Sunucun büyürken<br />panelin sade kalır.</h2>
            <p>Minecraft ve Terraria sunucularında günlük işleri sadeleştiren; ayrıntı isteyen yöneticilere konsol, yedek ve kaynak görünümü sunan bir kontrol merkezi.</p>
            <ul><li><Icon name="check" /> Tek tık sürüm ve yazılım değiştirme</li><li><Icon name="check" /> Zamanlanmış ve manuel yedekler</li><li><Icon name="check" /> Canlı konsol ve oyuncu yönetimi</li><li><Icon name="check" /> Kaynak ve durum bildirimleri</li></ul>
          </div>
          <Dashboard />
        </div>
      </section>

      <section className="section faqSection" id="sss">
        <div className="faqShell">
          <div className="faqIntro"><Kicker icon="headset">Oyun sunucusu rehberi</Kicker><h2>Sık sorulanlar.</h2><p>Minecraft ve Terraria sunucu planları, beta kapsamı ve altyapı sınırları hakkında net yanıtlar.</p><a href="mailto:destek@riftory.com">destek@riftory.com <Icon name="arrow" size={16} /></a></div>
          <div className="faqList">{questions.map(([question, answer], index) => <article className={faq === index ? "open" : ""} key={question}><button aria-expanded={faq === index} onClick={() => setFaq(faq === index ? null : index)} type="button"><b>{question}</b><span><Icon name={faq === index ? "minus" : "plus"} size={18} /></span></button><div><p>{answer}</p></div></article>)}</div>
        </div>
      </section>

      <section className="cta"><span className="brandIcon big"><i /></span><div><Kicker icon="spark">Erken erişim</Kicker><h2>İlk oyun sunucunu birlikte açalım.</h2><p>Minecraft veya Terraria beta planını hazırla; gerçek kurulum açıldığında güncel kapsamı ve nihai fiyatı önce gör.</p></div><button className="button large" onClick={reserve} type="button">Betaya katıl <Icon name="arrow" /></button></section>

      <footer>
        <div className="footerGrid"><div><a className="brand" href="#top"><span className="brandIcon"><i /></span><b>RIFTORY</b></a><p>Minecraft ve Terraria için sade, şeffaf ve yönetilebilir oyun sunucusu deneyimi.</p></div><div><b>OYUN SUNUCULARI</b><a href="/minecraft-sunucu-kiralama">Minecraft sunucu kiralama</a><a href="/terraria-sunucu-kiralama">Terraria sunucu kiralama</a><a href="/kurulum">Paket yapılandırıcı</a><a href="/panel">Panel demosu</a></div><div><b>DESTEK</b><a href="#sss">Sık sorulanlar</a><a href="mailto:destek@riftory.com">İletişim</a><a href="/hesap">Hesap ve güvenlik</a></div><div><b>HESAP</b><a href="/giris">Giriş yap</a><a href="/giris?mode=register">Hesap oluştur</a><a href="#top">Kullanım koşulları</a><a href="#top">Gizlilik</a></div></div>
        <div className="copyright"><span>© 2026 Riftory. Tüm hakları saklıdır.</span><span><i /> Ürün ön izlemesi yayında</span></div>
      </footer>

      {modal && (
        <div className="modalBg" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(false); }}>
          <section aria-labelledby="modal-title" aria-modal="true" className="modal" role="dialog">
            <button aria-label="Pencereyi kapat" className="modalClose" onClick={() => setModal(false)} type="button"><Icon name="close" /></button>
            {!sent ? <>
              <div className="modalIcon"><Icon name="rocket" /></div><Kicker icon="spark">Kapalı beta</Kicker><h2 id="modal-title">Yerini şimdiden ayır.</h2><p>Ödeme almıyoruz. Altyapı testi tamamlandığında seçtiğin planın nihai fiyatını önce sana göndereceğiz.</p>
              <div className="modalPlan"><span className={"gameBadge " + (game === "terraria" ? "blue" : "")}>{game === "minecraft" ? "M" : "T"}</span><span><small>SEÇİLEN PLAN</small><b>{game === "minecraft" ? "Minecraft Java" : "Terraria"} · {ram} GB</b><i>{region} · {backup ? "Günlük yedek" : "Yedeksiz"}</i></span><strong>{total.toLocaleString("tr-TR")} TL<small>/ay tahmini</small></strong></div>
              <form onSubmit={submit}><label htmlFor="email">E-posta adresin</label><input autoFocus id="email" name="email" placeholder="ornek@email.com" required type="email" /><label className="consent"><input required type="checkbox" /><span>Beta açıldığında e-posta ile bilgilendirilmeyi kabul ediyorum.</span></label><button className="button large full" type="submit">Beta sırasına katıl <Icon name="arrow" /></button></form>
            </> : <div className="success"><span><Icon name="check" size={30} /></span><Kicker icon="spark">Kaydın hazır</Kicker><h2 id="modal-title">Sıraya katıldın.</h2><p>Beta açıldığında güncel fiyat ve kurulum daveti e-posta adresine gelecek.</p><button className="ghost bordered" onClick={() => setModal(false)} type="button">Siteye dön</button></div>}
          </section>
        </div>
      )}
    </main>
  );
}

function Kicker({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return <span className="kicker"><Icon name={icon} size={16} />{children}</span>;
}

function SectionTitle({ kicker, icon, title, text }: { kicker: string; icon: IconName; title: React.ReactNode; text: string }) {
  return <div className="sectionTitle"><div><Kicker icon={icon}>{kicker}</Kicker><h2>{title}</h2></div><p>{text}</p></div>;
}

function Metric({ icon, label, value, fill }: { icon: IconName; label: string; value: string; fill: string }) {
  return <div><span><Icon name={icon} size={14} />{label}</span><b>{value}</b><i><em style={{ width: fill }} /></i></div>;
}

function Field({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return <div className="field"><div className="fieldLabel"><label>{label}</label>{note && <span>{note}</span>}</div>{children}</div>;
}

function Choice({ selected, onClick, badge, title, sub, blue }: { selected: boolean; onClick: () => void; badge: string; title: string; sub: string; blue?: boolean }) {
  return <button className={selected ? "selected" : ""} onClick={onClick} type="button"><span className={"gameBadge " + (blue ? "blue" : "")}>{badge}</span><span><b>{title}</b><small>{sub}</small></span><Icon name="check" size={15} /></button>;
}

function Step({ no, icon, title, children }: { no: string; icon: IconName; title: string; children: React.ReactNode }) {
  return <article><span>{no}</span><div><Icon name={icon} /></div><h3>{title}</h3><p>{children}</p></article>;
}

function Dashboard() {
  return <div className="dashboard"><aside><b>R</b><span><i className="active"/><i/><i/><i/><i/></span><em>F</em></aside><div className="dashBody"><header><span><small>SUNUCULARIM / MINECRAFT</small><b>Fatih&apos;in Dünyası</b></span><em><i /> Aktif</em></header><div className="dashStats"><span><small>OYUNCULAR</small><b>7 <i>/ 15</i></b></span><span><small>GECİKME</small><b>12 <i>ms</i></b></span><span><small>SON YEDEK</small><b>2 <i>dk</i></b></span></div><div className="chart"><header><span><small>KAYNAK KULLANIMI</small><b>Son 12 saat</b></span><em>● RAM　● CPU</em></header><div><i/><i/><i/><i/><i/><svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 600 130"><path d="M0 105 C45 98 55 61 105 73 S175 101 220 69 S290 38 325 60 S390 88 430 48 S515 30 600 57"/><path d="M0 87 C70 75 90 92 140 82 S220 53 265 76 S350 103 390 79 S470 63 520 76 S570 81 600 70"/></svg></div></div><div className="dashBottom"><span><small>OTOMATİK YEDEKLEME</small><b>Her gün, 04:00</b></span><button type="button">Yedek al <Icon name="arrow" size={13} /></button></div></div></div>;
}
