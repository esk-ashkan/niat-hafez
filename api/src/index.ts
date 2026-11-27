import faalsRaw from "../data/faals.json";
import { createClient } from "@supabase/supabase-js";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  WEB_APP_URL: string;
  BLUPAL_API_KEY: string;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  APINEX_API_KEY?: string;
  APINEX_MODEL?: string;
  BLUPAL_MODE?: "sandbox" | "live";
}

type Faal = {
  id: number;
  title: string;
  poem: string;
  interpretation: string;
};

type ProfileRow = {
  tgid: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  free_remaining: number;
  remained_hafez: number;
  ai_free_remaining: number;
  remained_ai: number;
  referral_code: string | null;
  referred_by: number | null;
  created_at?: string;
  last_visit?: string;
};

const PACKAGES: Record<
  string,
  { id: string; title: string; amount_rial: number; grant: number; service: "traditional" | "ai" }
> = {
  hafez_1: {
    id: "hafez_1",
    title: "۱ فال حافظ",
    amount_rial: 249_000,
    grant: 1,
    service: "traditional",
  },
  hafez_5: {
    id: "hafez_5",
    title: "۵ فال حافظ",
    amount_rial: 990_000,
    grant: 5,
    service: "traditional",
  },
  hafez_10: {
    id: "hafez_10",
    title: "۱۰ فال حافظ",
    amount_rial: 1_749_000,
    grant: 10,
    service: "traditional",
    service: "traditional",
  },
  ai_1: { id: "ai_1", title: "۱ تعبیر شخصی هوشمند", amount_rial: 490_000, grant: 1, service: "ai" },
  ai_5: { id: "ai_5", title: "۵ تعبیر شخصی هوشمند", amount_rial: 1_990_000, grant: 5, service: "ai" },
  ai_10: { id: "ai_10", title: "۱۰ تعبیر شخصی هوشمند", amount_rial: 3_499_000, grant: 10, service: "ai" },
};

const list: Faal[] =
  typeof faalsRaw === "string"
    ? (JSON.parse(faalsRaw) as Faal[])
    : (faalsRaw as Faal[]);

const cors: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...cors,
    },
  });
}

function sb(env: Env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
}

type TelegramUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function authenticateTelegram(request: Request, env: Env): Promise<TelegramUser | null> {
  const raw = request.headers.get("X-Telegram-Init-Data");
  if (!raw || raw.length > 8192) return null;

  const params = new URLSearchParams(raw);
  const hashes = params.getAll("hash");
  const dates = params.getAll("auth_date");
  const users = params.getAll("user");
  if (hashes.length !== 1 || dates.length !== 1 || users.length !== 1) return null;

  const receivedHash = hashes[0];
  const authDate = Number(dates[0]);
  const now = Math.floor(Date.now() / 1000);
  if (!/^[a-f0-9]{64}$/i.test(receivedHash) || !Number.isInteger(authDate) ||
      authDate > now + 30 || now - authDate > 86400) return null;

  const checkString = Array.from(params.entries())
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + "=" + value)
    .join("\n");

  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const secret = await crypto.subtle.sign("HMAC", secretKey, encoder.encode(env.TELEGRAM_BOT_TOKEN));
  const signingKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const expectedHash = toHex(await crypto.subtle.sign("HMAC", signingKey, encoder.encode(checkString)));
  if (!constantTimeEqual(expectedHash, receivedHash.toLowerCase())) return null;

  try {
    const user = JSON.parse(users[0]) as TelegramUser;
    if (!Number.isSafeInteger(user.id) || user.id <= 0) return null;
    return user;
  } catch {
    return null;
  }
}

function publicProfile(p: ProfileRow) {
  return {
    tgid: p.tgid,
    username: p.username,
    first_name: p.first_name,
    last_name: p.last_name,
    free_remaining: p.free_remaining,
    remained_hafez: p.remained_hafez,
    ai_free_remaining: p.ai_free_remaining,
    remained_ai: p.remained_ai,
    referral_code: p.referral_code,
    referred_by: p.referred_by,
    total_credit: (p.free_remaining || 0) + (p.remained_hafez || 0),
    total_ai_credit: (p.ai_free_remaining || 0) + (p.remained_ai || 0),
  };
}

function randomFaal(): Faal {
  if (!list.length) {
    return {
      id: 0,
      title: "—",
      poem: "داده فال در دسترس نیست.",
      interpretation: "",
    };
  }
  return list[Math.floor(Math.random() * list.length)];
}


const INTENTIONS: Record<string, string> = {
  general: "عمومی",
  love: "عشقی و عاطفی",
  career: "کاری و شغلی",
  financial: "مالی و اقتصادی",
  education: "تحصیلی",
  family: "خانوادگی",
  migration: "مهاجرت و سفر",
  decision: "تصمیم‌گیری",
};

function validateInterpretation(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length > 5000) return null;

  const lines = text.split(/\r?\n/).map((line) =>
    line.trim().replace(/^#+\s*/, "").replace(/^\*+|\*+$/g, "").trim()
  );
  const headings = [
    /^(?:[۱1][).．-]\s*)?پیوند با غزل[:：]?$/,
    /^(?:[۲2][).．-]\s*)?خوانش متناسب با نیت[:：]?$/,
    /^(?:[۳3][).．-]\s*)?نکتهٔ تأملی[:：]?$/,
  ];

  const positions = headings.map((pattern) => lines.findIndex((line) => pattern.test(line)));
  if (positions.some((position) => position < 0)) return null;
  if (!(positions[0] < positions[1] && positions[1] < positions[2])) return null;

  for (let i = 0; i < positions.length; i++) {
    const end = i + 1 < positions.length ? positions[i + 1] : lines.length;
    const section = lines.slice(positions[i] + 1, end).join(" ").trim();
    if (section.length < 20) return null;
  }

  return text;
}

async function requestInterpretation(
  provider: "groq" | "apinex",
  apiKey: string,
  model: string,
  endpoint: string,
  faal: Faal,
  intention: string
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.55,
        max_tokens: 700,
                messages: [
          {
            role: "system",
            content: [
              "تو یک مفسر ادبی غزل‌های حافظ هستی، نه پیشگو و نه مشاور تخصصی.",
              "فقط به زبان فارسی روان، محترمانه و روشن بنویس.",
              "تعبیر اولیه را مبنا بگیر؛ آن را حذف یا نقض نکن، فقط با توجه به نیت کاربر روشن‌تر و کاربردی‌ترش کن.",
              "به واژه‌ها، تصاویر و فضای غزل وفادار بمان؛ معنای شعر را عوض نکن و از غزل نتیجهٔ اجباری نساز.",
              "لحن: آرام، امیدوار اما واقع‌بین؛ بدون اغراق، بدون ترس‌افکنی.",
              "ممنوع: پیش‌بینی قطعی زمانی («حتماً تا فلان روز»)، وعدهٔ تضمینی پول/ازدواج/شفا، دستورالعمل پزشکی/حقوقی/مالی، طالع‌بینی خرافی سنگین، یا نصیحت تهدیدآمیز.",
              "ساختار پاسخ دقیقاً سه بخش کوتاه با همین عنوان‌ها:",
              "۱) پیوند با غزل",
              "۲) خوانش متناسب با نیت",
              "۳) نکتهٔ تأملی",
              "هر بخش حداکثر ۲–۳ جمله.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `نیت کاربر: ${INTENTIONS[intention] || INTENTIONS.general}`,
              `کد نیت: ${intention}`,
              "",
              `عنوان غزل: ${faal.title}`,
              "",
              "متن غزل:",
              faal.poem,
              "",
              "تعبیر اولیه (منبع اصلی؛ نباید تحریف شود):",
              faal.interpretation || "—",
              "",
              "وظیفه: تعبیری بنویس که همان روح تعبیر اولیه را حفظ کند، اما تأکید و مثال‌هایش با نیت کاربر هم‌راستا باشد.",
              "اگر نیت با غزل فاصله دارد، با احتیاط و بدون تحمیل معنا، فقط زاویهٔ نگاه را نرم تنظیم کن.",
            ].join("\n"),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`${provider.toUpperCase()}_HTTP_ERROR:`, response.status, errorBody.slice(0, 1200));
      return null;
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    const text = typeof content === "string"
      ? content.trim()
      : Array.isArray(content)
        ? content.map((part) => part.text || "").join("").trim()
        : "";
    const validated = validateInterpretation(text);
    if (!validated && text) console.warn(`${provider.toUpperCase()}_INVALID_INTERPRETATION_FORMAT`);
    return validated;
  } catch (error) {
    console.error(
      `${provider.toUpperCase()}_EXCEPTION:`,
      error instanceof Error ? error.message : String(error)
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function enhanceInterpretation(env: Env, faal: Faal, intention: string) {
  if (env.GROQ_API_KEY) {
    const groqResult = await requestInterpretation(
      "groq",
      env.GROQ_API_KEY,
      env.GROQ_MODEL || "openai/gpt-oss-20b",
      "https://api.groq.com/openai/v1/chat/completions",
      faal,
      intention
    );
    if (groqResult) {
      console.log("INTERPRETATION_PROVIDER: groq");
      return { text: groqResult, provider: "groq" as const };
    }
  } else {
    console.warn("GROQ_API_KEY is not configured; skipping primary provider.");
  }

  if (env.APINEX_API_KEY) {
    const apinexResult = await requestInterpretation(
      "apinex",
      env.APINEX_API_KEY,
      env.APINEX_MODEL || "free/gemini-3.8-flash",
      "https://api.apinex.bond/v1/chat/completions",
      faal,
      intention
    );
    if (apinexResult) {
      console.log("INTERPRETATION_PROVIDER: apinex_fallback");
      return { text: apinexResult, provider: "apinex" as const };
    }
  } else {
    console.warn("APINEX_API_KEY is not configured; fallback unavailable.");
  }

  console.error("INTERPRETATION_PROVIDER: original_fallback");
  return null;
}


async function getProfile(env: Env, tgid: number) {
  const { data, error } = await sb(env)
    .from("profile")
    .select("*")
    .eq("tgid", tgid)
    .maybeSingle();
  if (error) throw error;
  return data as ProfileRow | null;
}

async function ensureProfile(
  env: Env,
  user: {
    tgid: number;
    username?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  }
) {
  const now = new Date().toISOString();
  const row = {
    tgid: user.tgid,
    username: user.username || null,
    first_name: user.first_name || null,
    last_name: user.last_name || null,
    free_remaining: 3,
    remained_hafez: 0,
    ai_free_remaining: 2,
    remained_ai: 0,
    referral_code: `H${user.tgid.toString(36).toUpperCase()}`,
    created_at: now,
    last_visit: now,
  };

  // Insert only when the profile does not exist. On a concurrent first request,
  // the primary-key conflict is ignored without overwriting existing credits.
  const { error: insertError } = await sb(env)
    .from("profile")
    .upsert(row, { onConflict: "tgid", ignoreDuplicates: true });
  if (insertError) throw insertError;

  // Refresh Telegram profile metadata after ensuring the row exists.
  const { error: updateError } = await sb(env)
    .from("profile")
    .update({
      username: user.username ?? undefined,
      first_name: user.first_name ?? undefined,
      last_name: user.last_name ?? undefined,
      last_visit: now,
    })
    .eq("tgid", user.tgid);
  if (updateError) throw updateError;

  const profile = await getProfile(env, user.tgid);
  if (!profile) throw new Error("profile_creation_failed");
  return profile;
}

async function isRateLimited(env: Env, key: string, limit: number, windowSeconds: number) {
  const { data, error } = await sb(env).rpc("consume_api_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new Error("rate_limit_check_failed: " + error.message);
  return data !== true;
}

async function consumeCredit(env: Env, tgid: number) {
  const { data, error } = await sb(env).rpc("consume_hafez_credit", {
    p_tgid: tgid,
  });
  if (error) throw new Error("credit_consumption_failed: " + error.message);

  const result = data as {
    ok?: boolean;
    reason?: string;
    profile?: ProfileRow | null;
  } | null;

  if (!result?.ok || !result.profile) {
    const existing = result?.profile ?? await getProfile(env, tgid);
    return {
      ok: false as const,
      error: result?.reason === "no_profile" || !existing
        ? "no_profile" as const
        : "no_credit" as const,
      profile: existing,
    };
  }

  return { ok: true as const, profile: result.profile };
}

async function consumeAiCredit(env: Env, tgid: number) {
  const { data, error } = await sb(env).rpc("consume_ai_credit", { p_tgid: tgid });
  if (error) throw new Error("ai_credit_consumption_failed: " + error.message);
  const result = data as { ok?: boolean; reason?: string; profile?: ProfileRow | null } | null;
  if (!result?.ok || !result.profile) {
    const existing = result?.profile ?? await getProfile(env, tgid);
    return { ok: false as const, error: result?.reason === "no_profile" || !existing ? "no_profile" as const : "no_credit" as const, profile: existing };
  }
  return { ok: true as const, profile: result.profile };
}

async function processPaidAiPayment(env: Env, invoiceId: number) {
  const { data, error } = await sb(env).rpc("process_paid_ai_payment", { p_invoice_id: invoiceId });
  if (error) throw new Error(JSON.stringify(error));
  return data as { ok: boolean; reason?: string; already_paid?: boolean; granted?: number };
}

async function tgApi(env: Env, method: string, body: unknown) {
  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json() as { ok?: boolean; description?: string };
  if (!res.ok || data.ok === false) {
    throw new Error("telegram_api_request_failed: " + (data.description || res.status));
  }
  return data;
}

async function handleTelegramUpdate(env: Env, update: any) {
  const msg = update.message;
  if (!msg?.text || !msg.chat?.id) return;

  const text = String(msg.text);
  const chatId = msg.chat.id;
  const webAppUrl = env.WEB_APP_URL || "https://niat-hafez.pages.dev";

  if (text.startsWith("/start")) {
    await tgApi(env, "sendMessage", {
      chat_id: chatId,
      text:
        "به فال حافظ خوش آمدید ✨\n\n" +
        "برای تأمل، حالِ خوب و سرگرمی.\n" +
        "برای تصمیم‌های مهم زندگی به عقل، تجربه و مشاوران معتبر تکیه کنید.\n\n" +
        "برای شروع، دکمه زیر را بزنید:",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "📖 باز کردن فال‌نامه",
              web_app: { url: webAppUrl },
            },
          ],
        ],
      },
    });
    return;
  }

  if (text.startsWith("/terms")) {
    await tgApi(env, "sendMessage", {
      chat_id: chatId,
      text:
        "شرایط استفاده / Terms\n\n" +
        "این سرویس برای سرگرمی و تأمل است و توصیه قطعی یا جایگزین مشاوره تخصصی نیست.\n" +
        "This service is for reflection and entertainment, not professional advice.",
    });
    return;
  }

  await tgApi(env, "sendMessage", {
    chat_id: chatId,
    text: "برای شروع /start را بزنید یا از دکمه منو برنامه را باز کنید.",
  });
}

async function createBlupalInvoice(env: Env, amountRial: number) {
  const res = await fetch("https://blupal.top/api/v1/invoices/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": env.BLUPAL_API_KEY,
    },
    body: JSON.stringify({ amount: amountRial }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.message || data.error || "blupal_create_failed");
  }
  return data as {
    invoice_id: number;
    payment_link: string;
    amount: number;
    final_amount: number;
    status: string;
    mode: string;
  };
}

async function grantHafez(env: Env, tgid: number, grant: number) {
  const { data: profile, error: gErr } = await sb(env)
    .from("profile")
    .select("tgid, remained_hafez")
    .eq("tgid", tgid)
    .maybeSingle();
  if (gErr) throw new Error(JSON.stringify(gErr));
  if (!profile) throw new Error("no_profile");

  const next = Number(profile.remained_hafez || 0) + Number(grant);

  const { error: uErr } = await sb(env)
    .from("profile")
    .update({ remained_hafez: next })
    .eq("tgid", tgid);
  if (uErr) throw new Error(JSON.stringify(uErr));
}

async function processPaidPayment(env: Env, invoiceId: number) {
  const { data, error } = await sb(env).rpc("process_paid_payment", {
    p_invoice_id: invoiceId,
  });

  if (error) throw new Error(JSON.stringify(error));

  return data as {
    ok: boolean;
    reason?: string;
    already_paid?: boolean;
    granted?: number;
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/api/telegram/webhook") {
        if (request.method !== "POST") {
          return json({ error: "method_not_allowed" }, 405);
        }
        if (!env.TELEGRAM_WEBHOOK_SECRET) {
          console.error("TELEGRAM_WEBHOOK_SECRET is not configured");
          return json({ error: "webhook_not_configured" }, 503);
        }
        const suppliedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
        if (!constantTimeEqual(suppliedSecret, env.TELEGRAM_WEBHOOK_SECRET)) {
          return json({ error: "unauthorized" }, 401);
        }

        const contentLength = Number(request.headers.get("Content-Length") || 0);
        if (contentLength > 1_000_000) return json({ error: "payload_too_large" }, 413);

        let update: unknown;
        try {
          update = await request.json();
        } catch {
          return json({ error: "invalid_json" }, 400);
        }
        if (!update || typeof update !== "object" || Array.isArray(update)) {
          return json({ error: "invalid_update" }, 400);
        }

        await handleTelegramUpdate(env, update);
        return json({ ok: true });
      }

      if (path === "/" || path === "/health") {
        return json({ ok: true, service: "niat-hafez-api" });
      }

      if (path === "/api/profile") {
        if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
        const user = await authenticateTelegram(request, env);
        if (!user) return json({ error: "unauthorized" }, 401);
        if (await isRateLimited(env, `profile:${user.id}`, 60, 60)) {
          return json({ error: "rate_limited" }, 429);
        }
        const profile = await ensureProfile(env, { tgid: user.id, username: user.username, first_name: user.first_name, last_name: user.last_name });
        return json({ profile: publicProfile(profile) });
      }

      if (path === "/api/fal") {
        if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
        const user = await authenticateTelegram(request, env);
        if (!user) return json({ error: "unauthorized" }, 401);
        const tgid = user.id;
        if (await isRateLimited(env, `fal:${tgid}`, 12, 60)) {
          return json({ error: "rate_limited" }, 429);
        }

        await ensureProfile(env, { tgid: user.id, username: user.username, first_name: user.first_name, last_name: user.last_name });
        const currentProfile = await getProfile(env, tgid);
        if (!currentProfile) return json({ error: "no_profile" }, 404);
        if ((currentProfile.free_remaining || 0) + (currentProfile.remained_hafez || 0) <= 0) {
          return json({ error: "no_credit", profile: publicProfile(currentProfile) }, 402);
        }
        const faal = randomFaal();
        const spent = await consumeCredit(env, tgid);
        if (!spent.ok) return json({ error: spent.error || "no_credit", profile: spent.profile ? publicProfile(spent.profile) : null }, 402);
        return json({ faal: { ...faal, aiEnhanced: false }, profile: publicProfile(spent.profile!) });
      }

      if (path === "/api/ai/fal") {
        if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
        const user = await authenticateTelegram(request, env);
        if (!user) return json({ error: "unauthorized" }, 401);
        const tgid = user.id;
        if (await isRateLimited(env, `ai-fal:${tgid}`, 8, 60)) return json({ error: "rate_limited" }, 429);
        const requested = url.searchParams.get("intention") || "general";
        const intention = Object.prototype.hasOwnProperty.call(INTENTIONS, requested) ? requested : "general";
        await ensureProfile(env, { tgid, username: user.username, first_name: user.first_name, last_name: user.last_name });
        const current = await getProfile(env, tgid);
        if (!current) return json({ error: "no_profile" }, 404);
        if ((current.ai_free_remaining || 0) + (current.remained_ai || 0) <= 0) return json({ error: "no_ai_credit", profile: publicProfile(current) }, 402);
        const original = randomFaal();
        const enhanced = await enhanceInterpretation(env, original, intention);
        if (!enhanced) return json({ error: "ai_unavailable" }, 503);
        const spent = await consumeAiCredit(env, tgid);
        if (!spent.ok) return json({ error: spent.error || "no_ai_credit", profile: spent.profile ? publicProfile(spent.profile) : null }, 402);
        return json({ faal: { ...original, interpretation: enhanced.text, defaultInterpretation: original.interpretation, aiEnhanced: true, interpretationProvider: enhanced.provider, intention }, profile: publicProfile(spent.profile!) });
      }

      if (path === "/api/ai/interpret" && request.method === "POST") {
        const user = await authenticateTelegram(request, env);
        if (!user) return json({ error: "unauthorized" }, 401);
        if (await isRateLimited(env, `ai-interpret:${user.id}`, 8, 60)) return json({ error: "rate_limited" }, 429);
        const body = await request.json() as { faal_id?: number; intention?: string };
        const faalId = Number(body.faal_id);
        const requested = body.intention || "general";
        const intention = Object.prototype.hasOwnProperty.call(INTENTIONS, requested) ? requested : "general";
        if (!Number.isSafeInteger(faalId)) return json({ error: "invalid_faal_id" }, 400);
        await ensureProfile(env, { tgid: user.id, username: user.username, first_name: user.first_name, last_name: user.last_name });
        const current = await getProfile(env, user.id);
        if (!current) return json({ error: "no_profile" }, 404);
        if ((current.ai_free_remaining || 0) + (current.remained_ai || 0) <= 0) return json({ error: "no_ai_credit", profile: publicProfile(current) }, 402);
        const original = list.find((item) => item.id === faalId);
        if (!original) return json({ error: "faal_not_found" }, 404);
        const enhanced = await enhanceInterpretation(env, original, intention);
        if (!enhanced) return json({ error: "ai_unavailable" }, 503);
        const spent = await consumeAiCredit(env, user.id);
        if (!spent.ok) return json({ error: spent.error || "no_ai_credit", profile: spent.profile ? publicProfile(spent.profile) : null }, 402);
        return json({ faal: { ...original, interpretation: enhanced.text, defaultInterpretation: original.interpretation, aiEnhanced: true, interpretationProvider: enhanced.provider, intention }, profile: publicProfile(spent.profile!) });
      }
      }

      if (path === "/payments/packages") {
        return json({ packages: Object.values(PACKAGES) });
      }

      if (path === "/api/pay/create" && request.method === "POST") {
        const user = await authenticateTelegram(request, env);
        if (!user) return json({ error: "unauthorized" }, 401);
        const body = (await request.json()) as { package_id?: string };
        const package_id = String(body.package_id || "");
        const pkg = PACKAGES[package_id];
        if (!pkg) return json({ error: "invalid_request" }, 400);
        const tgid = user.id;
        if (await isRateLimited(env, `pay-create:${tgid}`, 5, 600)) {
          return json({ error: "rate_limited" }, 429);
        }

        await ensureProfile(env, { tgid: user.id, username: user.username, first_name: user.first_name, last_name: user.last_name });

        const inv = await createBlupalInvoice(env, pkg.amount_rial);
        if (!Number.isSafeInteger(Number(inv.invoice_id)) || Number(inv.invoice_id) <= 0 ||
            typeof inv.payment_link !== "string" || !/^https:\/\//i.test(inv.payment_link) ||
            Number(inv.amount) !== pkg.amount_rial ||
            !env.BLUPAL_MODE || inv.mode !== env.BLUPAL_MODE) {
          throw new Error("invalid_blupal_invoice_response");
        }

        const { error } = await sb(env).from("payment").insert({
          invoice_id: inv.invoice_id,
          tgid,
          package_id: pkg.id,
          amount_rial: pkg.amount_rial,
          status: "PENDING",
        });
        if (error) throw error;

        return json({
          invoice_id: inv.invoice_id,
          payment_link: inv.payment_link,
          amount: inv.amount,
          final_amount: inv.final_amount,
          mode: inv.mode,
        });
      }

      if (path === "/api/pay/webhook" && request.method === "POST") {
        const sourceIp = request.headers.get("CF-Connecting-IP") || "unknown";
        if (await isRateLimited(env, `webhook:${sourceIp}`, 60, 60)) {
          return json({ error: "rate_limited" }, 429);
        }
        const payload = (await request.json()) as {
          event?: string;
          invoice_id?: number;
        };

        if (payload.event !== "payment.completed" || !payload.invoice_id) {
          return json({ received: true });
        }

        const invoiceId = Number(payload.invoice_id);

        const { data: pay, error } = await sb(env)
          .from("payment")
          .select("*")
          .eq("invoice_id", invoiceId)
          .maybeSingle();
        if (error) throw new Error(JSON.stringify(error));
        if (!pay) return json({ received: true, note: "unknown_invoice" });
        if (pay.status === "PAID") {
          return json({ received: true, note: "already_paid" });
        }

        const pkg = PACKAGES[pay.package_id];
        if (!pkg) return json({ received: true, note: "unknown_package" });

        const verifyRes = await fetch(
          `https://blupal.top/api/v1/invoices/${invoiceId}`,
          {
            headers: {
              "X-API-Key": env.BLUPAL_API_KEY,
            },
          }
        );

        let verified: any;

        try {
          verified = await verifyRes.json();
        } catch {
          return json({ error: "invalid_blupal_response" }, 502);
        }

        if (
          !verifyRes.ok ||
          !verified.success ||
          Number(verified.invoice_id) !== invoiceId ||
          verified.status !== "PAID" ||
          Number(verified.amount) !== Number(pay.amount_rial) ||
          !env.BLUPAL_MODE ||
          verified.mode !== env.BLUPAL_MODE
        ) {
          return json({ error: "payment_not_verified" }, 400);
        }

        const result = pkg.service === "ai"
          ? await processPaidAiPayment(env, invoiceId)
          : await processPaidPayment(env, invoiceId);

        if (!result.ok) {
          return json(
            { error: result.reason || "payment_processing_failed" },
            400
          );
        }
        if (result.already_paid) {
          return json({
            received: true,
            note: "already_paid",
          });
        }
        return json({
          received: true,
          granted: result.granted,
        });
      }

      if (path === "/api/pay/status") {
        const user = await authenticateTelegram(request, env);
        if (!user) return json({ error: "unauthorized" }, 401);
        if (await isRateLimited(env, `pay-status:${user.id}`, 30, 60)) {
          return json({ error: "rate_limited" }, 429);
        }
        const invoiceId = Number(url.searchParams.get("invoice_id") || 0);
        if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) return json({ error: "invoice_id_required" }, 400);
        const { data: pay, error } = await sb(env)
          .from("payment")
          .select("invoice_id, status, tgid")
          .eq("invoice_id", invoiceId)
          .eq("tgid", user.id)
          .maybeSingle();
        if (error) throw error;
        if (!pay) return json({ error: "not_found" }, 404);
        return json({ invoice_id: pay.invoice_id, status: pay.status });
      }

      if (path === "/api/pay/reconcile" && request.method === "POST") {
        const user = await authenticateTelegram(request, env);
        if (!user) return json({ error: "unauthorized" }, 401);
        const body = (await request.json()) as { invoice_id?: number };
        if (await isRateLimited(env, `pay-reconcile:${user.id}`, 5, 60)) {
          return json({ error: "rate_limited" }, 429);
        }
        const invoiceId = Number(body.invoice_id || 0);
        if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) return json({ error: "invoice_id_required" }, 400);

        const { data: pay, error } = await sb(env)
          .from("payment")
          .select("*")
          .eq("invoice_id", invoiceId)
          .eq("tgid", user.id)
          .maybeSingle();
        if (error) throw error;
        if (!pay) return json({ error: "not_found" }, 404);
        if (pay.status === "PAID") return json({ status: "PAID", note: "already" });

        const res = await fetch(
          `https://blupal.top/api/v1/invoices/${invoiceId}`,
          { headers: { "X-API-Key": env.BLUPAL_API_KEY } }
        );
        const remote = await res.json();
        if (
            !res.ok ||
            !remote.success ||
            Number(remote.invoice_id) !== invoiceId ||
            remote.status !== "PAID" ||
            Number(remote.amount) !== Number(pay.amount_rial) ||
            !env.BLUPAL_MODE ||
            remote.mode !== env.BLUPAL_MODE
          ) {
            return json({
              status: pay.status,
              error: "payment_not_verified",
            }, 400);
          }

        const pkg = PACKAGES[pay.package_id];
        if (!pkg) return json({ error: "unknown_package" }, 400);

        const result = pkg.service === "ai"
          ? await processPaidAiPayment(env, invoiceId)
          : await processPaidPayment(env, invoiceId);

        if (!result.ok) {
          return json(
            { error: result.reason || "payment_processing_failed" },
            400
          );
        }

        return json({
          status: "PAID",
          granted: result.granted,
          already_paid: result.already_paid,
        });
      }

      return json({ error: "not_found" }, 404);
    } catch (e: unknown) {
      console.error("API_REQUEST_FAILED", e instanceof Error ? e.message : String(e));
      return json({ error: "server_error" }, 500);
    }
  },
};