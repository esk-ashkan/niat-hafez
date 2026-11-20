const API = "https://niat-hafez-api.niat-hafez.workers.dev";

function withTimeout<T>(p: Promise<T>, ms = 12000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

export type Faal = {
  id: number;
  title: string;
  poem: string;
  interpretation: string;
  defaultInterpretation?: string;
  aiEnhanced?: boolean;
  intention?: string;
};

export type Profile = {
  tgid: number;
  username: string | null;
  first_name: string | null;
  free_remaining: number;
  remained_hafez: number;
  referral_code: string | null;
  total_credit?: number;
};

export type Package = {
  id: string;
  title: string;
  amount_rial: number;
  grant: number;
};

export async function ensureProfile(params: {
  tgid: number;
  username?: string;
  first_name?: string;
}): Promise<Profile> {
  const q = new URLSearchParams();
  q.set("tgid", String(params.tgid));
  if (params.username) q.set("username", params.username);
  if (params.first_name) q.set("fname", params.first_name);

  const res = await withTimeout(fetch(`${API}/?${q.toString()}`));
  if (!res.ok) throw new Error("ensure_failed");
  const data = await res.json();
  return data.profile;
}

export async function fetchFal(tgid: number, intention = "general") {
  const params = new URLSearchParams({ tgid: String(tgid), intention });
  const res = await withTimeout(fetch(`${API}/api/fal?${params.toString()}`), 35000);
  const data = await res.json();
  if (res.status === 402 || data.error === "no_credit") {
    const err = new Error("no_credit") as Error & { profile?: Profile };
    err.profile = data.profile;
    throw err;
  }
  if (!res.ok) throw new Error("fal_failed");
  return data as { faal: Faal; profile: Profile };
}

export async function getPackages(): Promise<Package[]> {
  const res = await withTimeout(fetch(`${API}/payments/packages`));
  if (!res.ok) throw new Error("packages_failed");
  const data = await res.json();
  return data.packages ?? [];
}

export function getTelegramUser(): {
  id: number;
  username?: string;
  first_name?: string;
} | null {
  try {
    const u = (
      window as unknown as {
        Telegram?: {
          WebApp?: {
            initDataUnsafe?: {
              user?: { id: number; username?: string; first_name?: string };
            };
          };
        };
      }
    ).Telegram?.WebApp?.initDataUnsafe?.user;
    if (u?.id) return u;
  } catch {
  }

  const saved = localStorage.getItem("tgid");
  if (saved && Number(saved) > 0) {
    return {
      id: Number(saved),
      username: localStorage.getItem("tg_username") || undefined,
      first_name: localStorage.getItem("tg_first_name") || undefined,
    };
  }
  return null;
}

export function initTelegramUi() {
  try {
    const wa = (
      window as unknown as {
        Telegram?: {
          WebApp?: { ready: () => void; expand: () => void };
        };
      }
    ).Telegram?.WebApp;
    wa?.ready();
    wa?.expand?.();
  } catch {
  }
}

export async function createPayment(
  tgid: number,
  package_id: string
): Promise<{ payment_link: string; invoice_id: number }> {
  const res = await withTimeout(
    fetch(`${API}/api/pay/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tgid, package_id }),
    })
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "pay_failed");
  return data;
}

export async function getPaymentStatus(invoice_id: number) {
  const res = await withTimeout(
    fetch(`${API}/api/pay/status?invoice_id=${invoice_id}`)
  );
  if (!res.ok) throw new Error("status_failed");
  return res.json() as Promise<{ status: string }>;
}