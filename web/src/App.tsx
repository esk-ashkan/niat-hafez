import { useEffect, useState } from "react";
import {
  createPayment,
  ensureProfile,
  fetchFal,
  getPackages,
  getPaymentStatus,
  getTelegramUser,
  initTelegramUi,
  type Faal,
  type Package,
  type Profile,
} from "./api";
import "./App.css";

type View = "home" | "pay";

export default function App() {
  const [view, setView] = useState<View>("home");
  const [tgid, setTgid] = useState<number | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [faal, setFaal] = useState<Faal | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

        localStorage.setItem("tgid", String(u.id));
        if (u.username) localStorage.setItem("tg_username", u.username);
        if (u.first_name) localStorage.setItem("tg_first_name", u.first_name);
        setTgid(u.id);
        if (!cancelled) setBootLoading(false);

        try {
          const p = await ensureProfile({
            tgid: u.id,
            username: u.username,
            first_name: u.first_name,
          });
          if (!cancelled) {
            setProfile(p);
            setError("");
          }
        } catch {
          if (!cancelled) {
            setError("خطا در اتصال به سرور. در صورت نیاز VPN را روشن کنید.");
          }
        }

        try {
          const pkgs = await getPackages();
          if (!cancelled) setPackages(pkgs);
        } catch {
          /* optional */
        }
      } finally {
        if (!cancelled) setBootLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(safety);
    };
  }, []);

  const total =
    (profile?.free_remaining || 0) + (profile?.remained_hafez || 0);

  async function onGetFal() {
    if (!tgid) return;
    setLoading(true);
    setError("");
    setFaal(null);
    try {
      const res = await fetchFal(tgid);
      setFaal(res.faal);
      setProfile(res.profile);
    } catch (e) {
      const err = e as Error & { profile?: Profile };
      if (err.message === "no_credit") {
        setError("اعتبار تمام شده. از بخش خرید پکیج تهیه کنید.");
        if (err.profile) setProfile(err.profile);
        setView("pay");
      } else {
        setError("خطا در دریافت فال. در صورت نیاز VPN را روشن کنید.");
      }
    } finally {
      setLoading(false);
    }
  }

  if (bootLoading) {
    return (
      <div className="page" dir="rtl">
        <p className="muted">در حال آماده‌سازی...</p>
      </div>
    );
  }

  return (
    <div className="page" dir="rtl">
      <header className="header">
        <h1>فال حافظ</h1>
        <p className="muted">نیت کنید، سپس فال بگیرید</p>
        <p className="disclaimer">
          این فال برای تأمل و سرگرمی است و جایگزین مشورت جدی نیست.
        </p>
        {profile && (
          <p className="credit">
            باقی‌مانده: {total} (رایگان {profile.free_remaining} / خریداری‌شده{" "}
            {profile.remained_hafez})
          </p>
        )}
        <div className="nav">
          <button type="button" onClick={() => setView("home")}>
            فال
          </button>
          <button type="button" onClick={() => setView("pay")}>
            خرید
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {view === "home" && (
        <>
          <button
            className="primary"
            type="button"
            disabled={loading || !tgid}
            onClick={onGetFal}
          >
            {loading ? "..." : "نیت کردم — گرفتن فال"}
          </button>

          {faal && (
            <article className="card">
              <h2>{faal.title}</h2>
              <pre className="poem">{faal.poem}</pre>
              {faal.interpretation && (
                <div className="tafsir">
                  <h3>تعبیر</h3>
                  <p>{faal.interpretation}</p>
                </div>
              )}
            </article>
          )}
        </>
      )}

      {view === "pay" && (
        <article className="card">
          <h2>خرید پکیج</h2>
          <p className="muted">پرداخت آنلاین به‌زودی فعال می‌شود.</p>
          {packages.map((p) => (
            <div key={p.id} className="pkg">
              <div>
                <b>{p.title}</b>
                <div>{p.amount_rial.toLocaleString("fa-IR")} ریال</div>
              </div>
              <button
                type="button"
                disabled={!tgid || loading}
                onClick={async () => {
                  if (!tgid) return;
                  setLoading(true);
                  setError("");
                  try {
                    const { payment_link, invoice_id } = await createPayment(tgid, p.id);
                    const wa = (window as any).Telegram?.WebApp;
                    if (wa?.openLink) wa.openLink(payment_link);
                    else window.open(payment_link, "_blank");

                    // soft poll after return
                    for (let i = 0; i < 12; i++) {
                      await new Promise((r) => setTimeout(r, 3000));
                      const st = await getPaymentStatus(invoice_id);
                      if (st.status === "PAID") {
                        const prof = await ensureProfile({ tgid });
                        setProfile(prof);
                        setError("");
                        setView("home");
                        break;
                      }
                    }
                  } catch {
                    setError("خطا در ایجاد فاکتور پرداخت.");
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                پرداخت
              </button>
            </div>
          ))}
        </article>
      )}
    </div>
  );
}