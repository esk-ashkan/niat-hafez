const API = "https://niat-hafez-api.niat-hafez.workers.dev";

function telegramHeaders(): HeadersInit {
  const initData = (window as any).Telegram?.WebApp?.initData as string | undefined;
  if (!initData) throw new Error("telegram_auth_required");
  return { "X-Telegram-Init-Data": initData };
}

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
  ai_free_remaining: number;
  remained_ai: number;
  referral_code: string | null;
  total_credit?: number;
  total_ai_credit?: number;
};

export type Package = {
  id: string;
  title: string;
  amount_rial: number;
  grant: number;
  service: "traditional" | "ai";
};

export async function ensureProfile(): Promise<Profile> {
  const res = await withTimeout(fetch(`${API}/api/profile`, {
    headers: telegramHeaders(),
  }));
  if (!res.ok) throw new Error(res.status === 401 ? "telegram_auth_failed" : "ensure_failed");
  const data = await res.json();
  return data.profile;
}

export async function fetchFal(intention = "general") {
  const params = new URLSearchParams({ intention });
  const res = await withTimeout(fetch(`${API}/api/fal?${params.toString()}`, {
    headers: telegramHeaders(),
  }), 50000);
  const data = await res.json();
  if (res.status === 402 || data.error === "no_credit") {
    const err = new Error("no_credit") as Error & { profile?: Profile };
    err.profile = data.profile;
    throw err;
  }
  if (res.status === 401) throw new Error("telegram_auth_failed");
  if (!res.ok) throw new Error("fal_failed");
  return data as { faal: Faal; profile: Profile };
}

export async function fetchAiFal(intention = "general") {
  const params = new URLSearchParams({ intention });
  const res = await withTimeout(fetch(`${API}/api/ai/fal?${params.toString()}`, {
    headers: telegramHeaders(),
  }), 50000);
  const data = await res.json();
  if (res.status === 402 || data.error === "no_ai_credit") {
    const err = new Error("no_ai_credit") as Error & { profile?: Profile };
    err.profile = data.profile;
    throw err;
  }
  if (!res.ok) throw new Error(data.error || "ai_fal_failed");
  return data as { faal: Faal; profile: Profile };
}

export async function interpretFaal(faal_id: number, intention = "general") {
  const res = await withTimeout(fetch(`${API}/api/ai/interpret`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...telegramHeaders() },
    body: JSON.stringify({ faal_id, intention }),
  }), 50000);
  const data = await res.json();
  if (res.status === 402 || data.error === "no_ai_credit") {
    const err = new Error("no_ai_credit") as Error & { profile?: Profile };
    err.profile = data.profile;
    throw err;
  }
  if (!res.ok) throw new Error(data.error || "ai_interpretation_failed");
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
  const u = (window as any).Telegram?.WebApp?.initDataUnsafe?.user;
  return Number.isSafeInteger(u?.id) && u.id > 0 ? u : null;
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
  package_id: string
): Promise<{ payment_link: string; invoice_id: number }> {
  const res = await withTimeout(
    fetch(`${API}/api/pay/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...telegramHeaders() },
      body: JSON.stringify({ package_id }),
    })
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "pay_failed");
  return data;
}

export async function getPaymentStatus(invoice_id: number) {
  const res = await withTimeout(
    fetch(`${API}/api/pay/status?invoice_id=${invoice_id}`, {
      headers: telegramHeaders(),
    })
  );
  if (!res.ok) throw new Error("status_failed");
  return res.json() as Promise<{ status: string }>;
}

export async function reconcilePayment(invoice_id: number) {
  const res = await withTimeout(
    fetch(`${API}/api/pay/reconcile`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...telegramHeaders() },
      body: JSON.stringify({ invoice_id }),
    }),
    20000
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "reconcile_failed");
  return data as { status: string; granted?: number; already_paid?: boolean };
}
