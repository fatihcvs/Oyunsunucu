import type { CSSProperties } from "react";
import Link from "next/link";
import {
  BACKUP_MONTHLY_PRICE,
  HOSTING_PLANS,
  formatTry,
  getGame,
} from "@/lib/catalog";
import type { GameSeoContent } from "@/lib/seo-content";
import { absoluteUrl, serializeJsonLd, SITE_NAME } from "@/lib/seo";
import { Icon, type IconName } from "./icon";
import { ProductFooter } from "./product-footer";
import { ProductHeader } from "./product-header";

const featureIcons: IconName[] = ["layers", "gamepad", "shield"];
const panelIcons: IconName[] = ["terminal", "hardDrive", "activity", "settings"];

export function GameSeoLanding({ content }: { content: GameSeoContent }) {
  const game = getGame(content.id);
  const starterPlan = HOSTING_PLANS[0];
  const pageUrl = absoluteUrl(content.slug);
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": pageUrl,
        url: pageUrl,
        name: `${content.metaTitle} | ${SITE_NAME}`,
        description: content.metaDescription,
        inLanguage: "tr-TR",
        isPartOf: {
          "@type": "WebSite",
          "@id": `${absoluteUrl("/")}#website`,
          name: SITE_NAME,
          url: absoluteUrl("/"),
        },
        about: {
          "@type": "Service",
          name: `${game.name} oyun sunucusu barındırma`,
          serviceType: `${game.name} sunucu hosting`,
          provider: {
            "@type": "Organization",
            name: SITE_NAME,
            url: absoluteUrl("/"),
          },
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Ana sayfa",
            item: absoluteUrl("/"),
          },
          {
            "@type": "ListItem",
            position: 2,
            name: content.metaTitle,
            item: pageUrl,
          },
        ],
      },
    ],
  };

  return (
    <main
      className="productPage gameSeoPage"
      style={{ "--game-accent": content.accent } as CSSProperties}
    >
      <script
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        type="application/ld+json"
      />
      <div className="noise" aria-hidden="true" />
      <ProductHeader active="games" />

      <section className="gameSeoHero">
        <div className="gameSeoHeroCopy">
          <nav aria-label="İçerik yolu" className="seoBreadcrumb">
            <Link href="/">Ana sayfa</Link><span>/</span><Link href="/#oyunlar">Oyun sunucuları</Link><span>/</span><strong>{game.name}</strong>
          </nav>
          <span className="eyebrow"><i /> {content.eyebrow}</span>
          <h1>{content.title} <em>{content.titleAccent}</em></h1>
          <p>{content.intro}</p>
          <div className="gameSeoHeroButtons">
            <a className="button large" href={`/kurulum?game=${content.id}`}>
              Sunucu planını oluştur <Icon name="arrow" />
            </a>
            <Link className="ghost bordered" href="/panel">
              <Icon name="play" size={16} /> Panel demosunu incele
            </Link>
          </div>
          <p className="seoHonesty"><Icon name="shield" size={17} /><span><b>Şeffaf beta</b> {content.statusNote}</span></p>
        </div>

        <aside className="gameSeoOffer" aria-label={`${game.name} beta planı özeti`}>
          <header>
            <span className={`gameBadge ${content.id === "terraria" ? "blue" : ""}`}>{game.letter}</span>
            <div><small>{content.status}</small><h2>{game.name}</h2></div>
            <em><i /> ÖN İZLEME</em>
          </header>
          <dl>
            {content.highlights.map((item) => (
              <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>
            ))}
          </dl>
          <div className="seoOfferPrice">
            <span><small>BAŞLANGIÇ PLANI</small><b>{formatTry(starterPlan.price)} <em>/ ay</em></b></span>
            <span>{starterPlan.ram} GB RAM · {starterPlan.storage} GB NVMe</span>
          </div>
          <p>Tahmini KDV dahil beta fiyatıdır. Günlük yedek isteğe bağlı olarak +{formatTry(BACKUP_MONTHLY_PRICE)}/ay.</p>
          <a href={`/kurulum?game=${content.id}&plan=${starterPlan.id}`}>Paketi yapılandır <Icon name="arrow" size={16} /></a>
        </aside>
      </section>

      <dl className="seoFactRail">
        {content.highlights.map((item, index) => (
          <div key={item.label}><span>0{index + 1}</span><dt>{item.label}</dt><dd>{item.value}</dd></div>
        ))}
      </dl>

      <section className="gameSeoSection gameSeoWhy">
        <header className="seoSectionHeading">
          <span className="kicker"><Icon name="spark" size={16} /> Doğru planı seç</span>
          <h2>{content.whyTitle}</h2>
          <p>{content.whyIntro}</p>
        </header>
        <div className="seoFeatureGrid">
          {content.features.map((feature, index) => (
            <article key={feature.title}>
              <span><Icon name={featureIcons[index] ?? "server"} /></span>
              <small>0{index + 1}</small>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="gameSeoSection seoPricingSection" id="paketler">
        <header className="seoSectionHeading split">
          <div><span className="kicker"><Icon name="wallet" size={16} /> Tahmini beta fiyatları</span><h2>{content.softwareTitle}</h2></div>
          <p>{content.softwareIntro}</p>
        </header>
        <div className="seoPlanGrid">
          {HOSTING_PLANS.map((plan) => (
            <article className={plan.id === "starter-4" ? "recommended" : ""} key={plan.id}>
              {plan.id === "starter-4" && <em>ÖNERİLEN BAŞLANGIÇ</em>}
              <small>{plan.label}</small>
              <h3>{plan.ram} GB <span>RAM</span></h3>
              <ul>
                <li><Icon name="users" size={15} /> {plan.players}</li>
                <li><Icon name="hardDrive" size={15} /> {plan.storage} GB NVMe</li>
                <li><Icon name="cpu" size={15} /> {plan.cpu} CPU</li>
              </ul>
              <strong>{formatTry(plan.price)} <small>/ ay</small></strong>
              <a href={`/kurulum?game=${content.id}&plan=${plan.id}`}>Planı seç <Icon name="arrow" size={15} /></a>
            </article>
          ))}
        </div>
        <p className="seoPriceNote"><Icon name="activity" size={17} /> Oyuncu aralıkları başlangıç tahminidir; gerçek kapasite oyun ayarlarına, dünyaya, modlara ve eklentilere göre değişebilir.</p>
      </section>

      <section className="gameSeoSection seoPanelStory">
        <div className="seoPanelCopy">
          <span className="kicker"><Icon name="server" size={16} /> Yönetim deneyimi</span>
          <h2>{content.panelTitle}</h2>
          <p>{content.panelIntro}</p>
          <Link className="button" href="/panel">Çalışan panel demosu <Icon name="arrow" size={17} /></Link>
        </div>
        <div className="seoPanelFeatureGrid">
          {content.panelFeatures.map((feature, index) => (
            <article key={feature.title}>
              <span><Icon name={panelIcons[index] ?? "settings"} size={20} /></span>
              <div><h3>{feature.title}</h3><p>{feature.text}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section className="gameSeoSection seoFaqSection">
        <header className="seoSectionHeading">
          <span className="kicker"><Icon name="headset" size={16} /> Merak edilenler</span>
          <h2>{game.name} sunucusu hakkında sık sorulanlar</h2>
          <p>Beta kapsamı, paket seçimi ve teknik plan hakkında kısa, açık yanıtlar.</p>
        </header>
        <div className="seoDetailsList">
          {content.faq.map((item, index) => (
            <details key={item.question} open={index === 0}>
              <summary><span>0{index + 1}</span><b>{item.question}</b><Icon name="plus" size={18} /></summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="seoClosingCta">
        <span className={`gameBadge ${content.id === "terraria" ? "blue" : ""}`}>{game.letter}</span>
        <div><small>{content.eyebrow}</small><h2>{game.name} planını şimdi hazırla.</h2><p>Ödeme yapmadan kaynakları karşılaştır; seçimini cihazında taslak olarak sakla.</p></div>
        <a className="button large" href={`/kurulum?game=${content.id}`}>Yapılandırıcıyı aç <Icon name="arrow" /></a>
      </section>

      <ProductFooter />
    </main>
  );
}
