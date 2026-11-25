import { useEffect, useState, type ReactNode } from "react";
import {
  createPayment,
  ensureProfile,
  fetchFal,
  getPackages,
  getPaymentStatus,
  reconcilePayment,
  getTelegramUser,
  initTelegramUi,
  type Faal,
  type Package,
  type Profile,
} from "./api";
import "./App.css";

type View = "home" | "pay";
type Theme = "light" | "dark";
type IconName = "moon" | "sun" | "sparkle" | "book" | "cart" | "home" | "wallet" | "arrow" | "gift" | "help" | "refresh";

function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths: Record<IconName, ReactNode> = {
    moon: <path d="M20.2 15.2A8.6 8.6 0 0 1 8.8 3.8 8.7 8.7 0 1 0 20.2 15.2Z" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
    sparkle: <><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z" /><path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H20M8 7h8" /></>,
    cart: <><path d="M3 4h2l2.2 11.1a2 2 0 0 0 2 1.6h8.9a2 2 0 0 0 1.9-1.4L22 8H6" /><circle cx="10" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></>,
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10Z" /></>,
    wallet: <><rect x="3" y="6" width="18" height="15" rx="2.5" /><path d="M3 9V6a2 2 0 0 1 2-2h13M16 14h5" /><circle cx="16" cy="14" r=".7" fill="currentColor" /></>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
    gift: <><rect x="3" y="9" width="18" height="12" rx="2" /><path d="M2 6h20v4H2zM12 6v15M12 6H8.5a2.5 2.5 0 1 1 2.5-2.5V6Zm0 0h3.5A2.5 2.5 0 1 0 13 3.5V6Z" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9a2.5 2.5 0 1 1 4.3 1.7c-1.1 1-1.9 1.3-1.9 2.8m0 3h.01" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.5-3" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

export default function App() {
  const [view, setView] = useState<View>("home");
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem("niat-theme") as Theme) || "light"; } catch { return "light"; }
  });
  const [tgid, setTgid] = useState<number | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [faal, setFaal] = useState<Faal | null>(null);
  const [intention, setIntention] = useState("general");
  const [bootLoading, setBootLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    initTelegramUi();
    let cancelled = false;
    const safety = window.setTimeout(() => {
      if (!cancelled) setBootLoading(false);
    }, 2500);

    (async () => {
      try {
        let u = getTelegramUser();
        for (let i = 0; i < 12 && !u?.id; i++) {
          await new Promise((r) => setTimeout(r, 200));
          if (cancelled) return;
          u = getTelegramUser();
        }
        if (!u?.id) {
          if (!cancelled) {
            setError("از داخل ربات تلگرام وارد شوید.");
            setBootLoading(false);
          }
          return;
        }
        setTgid(u.id);
        if (!cancelled) setBootLoading(false);
        try {
          const p = await ensureProfile();
          if (!cancelled) { setProfile(p); setError(""); }
        } catch {
          if (!cancelled) setError("خطا در اتصال به سرور. در صورت نیاز VPN را روشن کنید.");
        }
        try {
          const pkgs = await getPackages();
          if (!cancelled) setPackages(pkgs);
        } catch { /* package list can be retried when opening purchase */ }
      } finally {
        if (!cancelled) setBootLoading(false);
      }
    })();

    return () => { cancelled = true; window.clearTimeout(safety); };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("niat-theme", theme); } catch { /* storage is optional */ }
  }, [theme]);

  const total = (profile?.free_remaining || 0) + (profile?.remained_hafez || 0);

  async function onGetFal() {
    if (!tgid) return;
    setLoading(true);
    setError("");
    setFaal(null);
    try {
      const res = await fetchFal(intention);
      setFaal(res.faal);
      setProfile(res.profile);
    } catch (e) {
      const err = e as Error & { profile?: Profile };
      if (err.message === "no_credit") {
        setError("اعتبار شما به پایان رسیده است. برای ادامه، یک بسته فال تهیه کنید.");
        if (err.profile) setProfile(err.profile);
        setView("pay");
      } else {
        setError("دریافت فال با مشکل روبه‌رو شد. لطفاً دوباره تلاش کنید.");
      }
    } finally { setLoading(false); }
  }

  async function onBuyPackage(p: Package) {
    if (!tgid) return;
    setLoading(true);
    setError("");
    try {
      const { payment_link, invoice_id } = await createPayment(p.id);
      const wa = (window as any).Telegram?.WebApp;
      if (wa?.openLink) wa.openLink(payment_link);
      else window.open(payment_link, "_blank");
      let paid = false;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const st = await getPaymentStatus(invoice_id);
        if (st.status === "PAID") {
          const prof = await ensureProfile();
          setProfile(prof);
          setError("");
          setView("home");
          paid = true;
          break;
        }
      }
      if (!paid) {
        try {
          const reconciled = await reconcilePayment(invoice_id);
          if (reconciled.status === "PAID") {
            const prof = await ensureProfile();
            setProfile(prof);
            setError("");
            setView("home");
            paid = true;
          }
        } catch {
          // The provider or webhook may still be processing; keep the invoice pending.
        }
      }
      if (!paid) {
        setError("وضعیت پرداخت هنوز نهایی نشده است. فاکتور شما محفوظ است؛ کمی بعد دوباره وارد برنامه شوید تا وضعیت آن بررسی شود.");
      }
    } catch (e) {
      const message = e instanceof Error && e.message === "telegram_auth_failed"
        ? "اعتبار ورود تلگرام تأیید نشد. برنامه را از داخل ربات دوباره باز کنید."
        : "در بررسی وضعیت پرداخت مشکلی پیش آمد. فاکتور شما حذف نشده است؛ کمی بعد دوباره بررسی کنید.";
      setError(message);
    } finally { setLoading(false); }
  }

  if (bootLoading) {
    return <main className="page boot-screen" dir="rtl"><div className="boot-orbit"><span /><i /><b>✦</b></div><p>در حال آماده‌سازی فال‌نامه...</p></main>;
  }

  return (
    <main className="page" dir="rtl">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="topbar">
        <a className="brand" href="#" onClick={(e) => { e.preventDefault(); setView("home"); }}>
          <span className="brand-mark"><Icon name="sparkle" size={23} /></span>
          <span><strong>فال‌نامه</strong><small>هم‌نشینی با غزل‌های حافظ</small></span>
        </a>
        <div className="top-actions">
          <button className="icon-button theme-toggle" type="button" aria-label="تغییر پوسته" onClick={() => setTheme(theme === "light" ? "dark" : "light")}><Icon name={theme === "light" ? "moon" : "sun"} /></button>
          <button className="icon-button help-button" type="button" aria-label="راهنما" title="راهنما" onClick={() => setGuideOpen(true)}><Icon name="help" /></button>
        </div>
      </header>

      <section className="hero-intro">
        <span className="eyebrow"><span /> لحظه‌ای برای خودت <span /></span>
        <h1>گاهی یک غزل،<br /><em>پاسخ یک دل است.</em></h1>
        <p>نیت کن و به دنیای شعر و حکمت حافظ قدم بگذار.</p>
        <div className="hero-stars" aria-hidden="true"><i>✦</i><i>✧</i><i>✦</i><i>·</i><i>✧</i></div>
      </section>

      {guideOpen && <div className="guide-backdrop" role="presentation" onClick={() => setGuideOpen(false)}><section className="guide-dialog" role="dialog" aria-modal="true" aria-labelledby="guide-title" onClick={(e) => e.stopPropagation()}><button className="guide-close" type="button" aria-label="بستن راهنما" onClick={() => setGuideOpen(false)}>×</button><span className="result-seal"><Icon name="book" size={22} /></span><h2 id="guide-title">چطور فال بگیریم؟</h2><p>لحظه‌ای آرام بگیر، نیتت را در دل مرور کن و دکمه «نیت کردم؛ فال بگیر» را بزن. غزل حافظ و تعبیر آن برایت نمایش داده می‌شود.</p><button className="primary-button guide-confirm" type="button" onClick={() => setGuideOpen(false)}>متوجه شدم</button></section></div>}

      {error && <div className="notice" role="status"><span className="notice-dot" />{error}<button type="button" aria-label="بستن پیام" onClick={() => setError("")}>×</button></div>}

      <section className="main-panel">
        <div className="panel-ornament" aria-hidden="true"><span>✧</span><i /><span>✧</span></div>
        {!faal || view === "pay" ? (
          <div className="intention-content">
            <div className="section-kicker"><span /> به نام عشق و روشنایی <span /></div>
            <h2>{view === "pay" ? "همراه غزل‌های حافظ بمان" : "نیت کن..."}</h2>
            <p className="panel-copy">{view === "pay" ? "بسته‌ای انتخاب کن و سفر خود را با شعر ادامه بده." : "لحظه‌ای آرام بگیر و به نیت قلبت فکر کن."}</p>
            <div className="crystal-scene" aria-hidden="true">
              <div className="orbit orbit-a" /><div className="orbit orbit-b" />
              <div className="crystal"><Icon name="sparkle" size={42} /></div>
              <div className="crystal-shadow" />
              <span className="crystal-star star-a">✦</span><span className="crystal-star star-b">✧</span><span className="crystal-star star-c">✦</span>
            </div>
            {view === "home" ? (
              <>
              <label className="intention-select-label" htmlFor="fortune-intention">نیت شما درباره چیست؟</label>
              <select id="fortune-intention" className="intention-select" value={intention} onChange={(e) => setIntention(e.target.value)}>
                <option value="general">عمومی</option>
                <option value="love">عشقی و عاطفی</option>
                <option value="career">کاری و شغلی</option>
                <option value="financial">مالی و اقتصادی</option>
                <option value="education">تحصیلی</option>
                <option value="family">خانوادگی</option>
                <option value="migration">مهاجرت و سفر</option>
                <option value="decision">تصمیم‌گیری</option>
              </select>
              <button className="primary-button" type="button" disabled={loading || !tgid} onClick={onGetFal}>
                {loading ? <span className="button-spinner" /> : <Icon name="sparkle" size={21} />}
                <span>{loading ? "در حال گشودن دیوان..." : "نیت کردم؛ فال بگیر"}</span><Icon name="arrow" size={19} />
              </button>
              </>
            ) : (
              <button className="text-button" type="button" onClick={() => setView("home")}>بازگشت به گرفتن فال <Icon name="arrow" size={17} /></button>
            )}
            <p className="gentle-note"><Icon name="sparkle" size={14} /> این فال برای تأمل و سرگرمی است.</p>
          </div>
        ) : (
          <article className="fortune-result">
            <div className="result-heading"><span className="result-seal"><Icon name="sparkle" size={22} /></span><span>فال شما</span></div>
            <h2>{faal.title}</h2>
            <pre className="poem">{faal.poem}</pre>
            {faal.interpretation && <div className="interpretation"><h3><Icon name="book" size={18} /> تعبیر فال</h3><p>{faal.interpretation}</p>{faal.defaultInterpretation && faal.defaultInterpretation !== faal.interpretation && <details className="default-interpretation"><summary>مشاهده تعبیر اولیه</summary><p>{faal.defaultInterpretation}</p></details>}</div>}
            <button className="secondary-button" type="button" disabled={loading} onClick={onGetFal}>{loading ? <span className="button-spinner" /> : <Icon name="refresh" size={18} />} فال دیگری بگیر</button>
          </article>
        )}
      </section>

      <section className="credit-card">
        <div className="credit-icon"><Icon name="wallet" size={28} /></div>
        <div className="credit-info"><span>اعتبار باقی‌مانده شما</span><strong>{profile ? total.toLocaleString("fa-IR") : "—"} <small>فال</small></strong><div className="credit-breakdown">رایگان: {(profile?.free_remaining || 0).toLocaleString("fa-IR")} <span>·</span> خریداری‌شده: {(profile?.remained_hafez || 0).toLocaleString("fa-IR")}</div></div>
        <button className="credit-action" type="button" onClick={() => setView("pay")}><Icon name="gift" size={18} /> افزایش اعتبار</button>
      </section>

      {view === "pay" && (
        <section className="packages-section">
          <div className="section-title"><div><span className="mini-kicker">ادامه همراهی</span><h2>بسته‌های فال</h2></div><span className="title-sparkle">✧</span></div>
          <div className="packages-grid">
            {packages.map((p, i) => <article className={`package-card ${i === 1 ? "package-featured" : ""}`} key={p.id}>
              {i === 1 && <span className="popular-tag">پیشنهاد محبوب</span>}
              <span className="package-count">{p.grant.toLocaleString("fa-IR")} <small>فال</small></span>
              <h3>{p.title}</h3>
              <p>{p.amount_rial.toLocaleString("fa-IR")} ریال</p>
              <button type="button" disabled={!tgid || loading} onClick={() => onBuyPackage(p)}>{loading ? "..." : "انتخاب بسته"} <Icon name="arrow" size={16} /></button>
            </article>)}
          </div>
          <p className="payment-note">پرداخت امن از طریق درگاه پرداخت انجام می‌شود.</p>
        </section>
      )}

      <footer className="footer-note"><span>✧</span> به یادگار از خواجه شیراز <span>✧</span></footer>

      <nav className="bottom-nav" aria-label="ناوبری اصلی">
        <button className={view === "home" ? "active" : ""} type="button" onClick={() => setView("home")}><Icon name="home" size={21} /><span>فال حافظ</span></button>
        <button className={view === "pay" ? "active" : ""} type="button" onClick={() => setView("pay")}><Icon name="cart" size={21} /><span>خرید اعتبار</span></button>
        <button type="button" onClick={() => setGuideOpen(true)}><Icon name="book" size={21} /><span>راهنما</span></button>
      </nav>
    </main>
  );
}
