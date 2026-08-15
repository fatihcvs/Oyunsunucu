import type { ActiveGameId } from "./catalog";

export type SeoHighlight = {
  label: string;
  value: string;
};

export type SeoFeature = {
  title: string;
  text: string;
};

export type SeoFaq = {
  question: string;
  answer: string;
};

export type GameSeoContent = {
  id: ActiveGameId;
  slug: string;
  accent: string;
  eyebrow: string;
  metaTitle: string;
  metaDescription: string;
  title: string;
  titleAccent: string;
  intro: string;
  status: string;
  statusNote: string;
  highlights: SeoHighlight[];
  whyTitle: string;
  whyIntro: string;
  features: SeoFeature[];
  softwareTitle: string;
  softwareIntro: string;
  panelTitle: string;
  panelIntro: string;
  panelFeatures: SeoFeature[];
  faq: SeoFaq[];
};

export const GAME_SEO_CONTENT: Record<ActiveGameId, GameSeoContent> = {
  minecraft: {
    id: "minecraft",
    slug: "/minecraft-sunucu-kiralama",
    accent: "#73d865",
    eyebrow: "Minecraft Java · Kapalı beta",
    metaTitle: "Minecraft Sunucu Kiralama ve Hosting",
    metaDescription:
      "Paper, Vanilla ve Fabric seçenekleriyle Minecraft Java sunucu planını oluştur. RAM, NVMe, yedekleme ve Türkçe panel deneyimini incele.",
    title: "Minecraft sunucu kiralama,",
    titleAccent: "teknik yük olmadan.",
    intro:
      "Paper, Vanilla veya Fabric kurulumunu seç; oyuncu sayına uygun RAM ve depolama planını karşılaştır. Riftory, Minecraft Java sunucusu kurma ve yönetme sürecini tek bir sade akışta topluyor.",
    status: "Beta planı hazırlanıyor",
    statusNote:
      "Bu sayfa ürün ve fiyat ön izlemesidir. Ödeme ve gerçek sunucu teslimi henüz etkin değildir.",
    highlights: [
      { label: "Sunucu yazılımı", value: "Paper · Vanilla · Fabric" },
      { label: "Kaynak seçenekleri", value: "2–12 GB RAM" },
      { label: "Kalıcı depolama", value: "10–60 GB NVMe" },
      { label: "İlk beta bölgesi", value: "Amsterdam · EU West" },
    ],
    whyTitle: "Minecraft sunucusu seçerken neye bakmalı?",
    whyIntro:
      "Doğru paket yalnızca oyuncu sayısıyla belirlenmez. Dünya boyutu, görüş mesafesi, eklenti sayısı ve mod paketi de kaynak ihtiyacını değiştirir. Bu yüzden Riftory planları RAM, depolama ve tahmini oyuncu aralığını birlikte gösterir.",
    features: [
      {
        title: "Paper ile eklenti odaklı kurulum",
        text: "Daha yüksek performans ve eklenti desteği isteyen topluluklar için önerilen başlangıç seçeneği.",
      },
      {
        title: "Vanilla ile sade deneyim",
        text: "Oyunun temel davranışını korumak ve mümkün olduğunca yalın bir dünya açmak isteyen ekipler için.",
      },
      {
        title: "Fabric ile hafif modlama",
        text: "Fabric uyumlu modlarla özelleştirilmiş bir Minecraft Java deneyimi planlayan gruplar için.",
      },
    ],
    softwareTitle: "Oyuncu sayına göre şeffaf paketler",
    softwareIntro:
      "Paketlerde tahmini oyuncu aralığı bir garanti değil, başlangıç rehberidir. Modlar, eklentiler ve dünya ayarları gerçek kapasiteyi etkiler; beta sırasında kullanım verisine göre yükseltme önerileri geliştirilecek.",
    panelTitle: "Minecraft sunucunu tek panelden yönet",
    panelIntro:
      "Komut satırına inmeden günlük işlemleri yapabileceğin Türkçe bir kontrol merkezi tasarlıyoruz. Panel demosu bugün incelenebilir; gerçek sunucu bağlantısı altyapı fazında açılacak.",
    panelFeatures: [
      { title: "Canlı konsol", text: "Sunucu çıktısını izle, planlanan RCON bağlantısıyla yönetim komutlarını çalıştır." },
      { title: "Yedekleme", text: "Manuel geri dönüş noktaları oluştur; isteğe bağlı günlük yedek planını etkinleştir." },
      { title: "Kaynak görünümü", text: "RAM ve CPU kullanımını anlaşılır grafiklerle takip et; paket sınırını erken gör." },
      { title: "Sürüm kontrolü", text: "Desteklenen Minecraft sürümü ve sunucu yazılımı değişikliklerini panelden yönet." },
    ],
    faq: [
      {
        question: "Minecraft sunucu kiralama beta sürecinde nasıl çalışacak?",
        answer:
          "Oyun, yazılım, RAM ve yedekleme seçeneklerini yapılandırıcıda seçersin. Canlı satış açıldığında ödeme onayından sonra kurulum otomasyonu başlayacak ve bağlantı bilgileri panelde gösterilecek.",
      },
      {
        question: "Paper, Vanilla ve Fabric arasında nasıl seçim yaparım?",
        answer:
          "Eklenti ve performans odağın varsa Paper, oyunun sade yapısını istiyorsan Vanilla, Fabric uyumlu modlar kullanacaksan Fabric daha uygun bir başlangıçtır.",
      },
      {
        question: "Minecraft sunucusu için kaç GB RAM gerekir?",
        answer:
          "İhtiyaç; oyuncu sayısı, görüş mesafesi, dünya boyutu, mod ve eklentilere göre değişir. Riftory 2–12 GB arası planları tahmini oyuncu aralıklarıyla gösterir; yoğun mod paketleri daha fazla kaynak isteyebilir.",
      },
      {
        question: "Paket yükseltirken Minecraft dünyam korunacak mı?",
        answer:
          "Canlı hizmette kaynak yükseltmelerinin dünya dosyalarını koruması ve riskli işlemlerden önce yedek alınması planlanıyor. Bu davranış gerçek oyun testleri tamamlanmadan garanti olarak sunulmayacak.",
      },
    ],
  },
  terraria: {
    id: "terraria",
    slug: "/terraria-sunucu-kiralama",
    accent: "#5dcde9",
    eyebrow: "Terraria · Kontrollü beta",
    metaTitle: "Terraria Sunucu Kiralama ve tModLoader Hosting",
    metaDescription:
      "Vanilla ve kontrollü tModLoader desteğiyle Terraria sunucu planını oluştur. RAM, NVMe, günlük yedekleme ve panel deneyimini incele.",
    title: "Terraria sunucu kiralama,",
    titleAccent: "kalıcı bir dünya için.",
    intro:
      "Arkadaş grubun için Vanilla Terraria dünyası planla; modlu oyun istiyorsan kontrollü tModLoader beta kapsamını incele. Kaynaklar, bölge, yedekleme ve panel tek akışta görünür.",
    status: "Kontrollü beta hazırlanıyor",
    statusNote:
      "Terraria satışı henüz açık değildir. Ön izleme, planı ve geliştirme kapsamını şeffaf biçimde gösterir.",
    highlights: [
      { label: "Sunucu yazılımı", value: "Vanilla · tModLoader" },
      { label: "Kaynak seçenekleri", value: "2–12 GB RAM" },
      { label: "Kalıcı depolama", value: "10–60 GB NVMe" },
      { label: "İlk beta bölgesi", value: "Amsterdam · EU West" },
    ],
    whyTitle: "Terraria hosting planında ne önemli?",
    whyIntro:
      "Terraria sunucusunda dünya boyutu, eş zamanlı oyuncu sayısı ve özellikle tModLoader içeriği kaynak ihtiyacını etkiler. Paket seçiminde yalnızca RAM miktarını değil, kalıcı depolamayı ve düzenli yedeklemeyi de birlikte değerlendirmek gerekir.",
    features: [
      {
        title: "Vanilla Terraria",
        text: "Oyunun temel çok oyunculu deneyimini koruyan, küçük ve orta ölçekli arkadaş grupları için sade kurulum.",
      },
      {
        title: "tModLoader kontrollü beta",
        text: "Topluluk modlarını kullanmak isteyen ekipler için uyumluluk ve kaynak testlerinden sonra kademeli açılacak seçenek.",
      },
      {
        title: "Kalıcı dünya ve yedek planı",
        text: "Dünya dosyasını yeniden başlatmalarda koruyacak depolama; manuel ve isteğe bağlı günlük geri dönüş noktaları.",
      },
    ],
    softwareTitle: "Küçük ekipten modlu topluluğa ölçeklenir",
    softwareIntro:
      "Başlangıç planları küçük arkadaş gruplarını, daha yüksek kaynaklı planlar ise modlu veya büyüyen toplulukları hedefler. Gösterilen oyuncu aralıkları tahminidir; gerçek kapasite dünya ve mod yapısına göre test edilecek.",
    panelTitle: "Terraria dünyanı sade panelden yönet",
    panelIntro:
      "Sunucuyu başlatma, durdurma, konsolu izleme ve yedek alma gibi günlük işler tek kontrol merkezinde toplanacak. Bugünkü panel demosu ürün davranışını gösterir; canlı veri içermez.",
    panelFeatures: [
      { title: "Durum kontrolü", text: "Başlat, durdur ve yeniden başlat işlemlerini çakışma korumalı görevlerle yönet." },
      { title: "Dünya yedekleri", text: "Güncellemelerden önce manuel yedek al; günlük yedek seçeneğiyle geri dönüş noktası oluştur." },
      { title: "Canlı günlük", text: "Sunucu başlatma çıktısını ve bağlantı durumunu tek ekrandan takip et." },
      { title: "Kaynak takibi", text: "RAM ve CPU kullanımını gör; tModLoader büyüdükçe paket ihtiyacını daha erken fark et." },
    ],
    faq: [
      {
        question: "Terraria sunucu kiralama hizmeti şu anda açık mı?",
        answer:
          "Hayır. Riftory şu anda kontrollü beta ürününü hazırlıyor. Yapılandırıcı plan ve tahmini fiyatı gösterir; ödeme almaz ve gerçek sunucu oluşturmaz.",
      },
      {
        question: "tModLoader desteği olacak mı?",
        answer:
          "tModLoader kontrollü beta kapsamındadır. Mod uyumluluğu, güncelleme ve yedekten dönüş testleri tamamlandıkça desteklenen kurulumlar kademeli açılacak.",
      },
      {
        question: "Terraria sunucusu için hangi paket uygun?",
        answer:
          "Küçük Vanilla dünyaları daha düşük kaynakla başlayabilir; büyük dünyalar ve modlu kurulumlar daha fazla RAM ve depolama isteyebilir. Paketlerdeki oyuncu aralıkları başlangıç tahminidir.",
      },
      {
        question: "Terraria dünya dosyam yeniden başlatmada korunacak mı?",
        answer:
          "Kalıcı NVMe depolama ve kontrollü kapanış tasarımın parçasıdır. Dünya koruması, yeniden dağıtım ve yedekten dönüş testleri geçtikten sonra canlı hizmete alınacak.",
      },
    ],
  },
};

