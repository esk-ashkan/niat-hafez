import faalsRaw from "../data/faals.json";
import { createClient } from "@supabase/supabase-js";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  WEB_APP_URL: string;
  BLUPAL_API_KEY: string;
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
  referral_code: string | null;
  referred_by: number | null;
  created_at?: string;
  last_visit?: string;
};

const PACKAGES: Record<
  string,
  { id: string; title: string; amount_rial: number; grant: number }
> = {
  hafez_1: {
    id: "hafez_1",
    title: "۱ فال حافظ",
    amount_rial: 490_000,
    grant: 1,
  },
  hafez_5: {
    id: "hafez_5",
    title: "۵ فال حافظ",
    amount_rial: 2_000_000,
    grant: 5,
  },
  hafez_10: {
    id: "hafez_10",
    title: "۱۰ فال حافظ",
    amount_rial: 3_500_000,
    grant: 10,
  },
};

const list: Faal[] =
  typeof faalsRaw === "string"
    ? (JSON.parse(faalsRaw) as Faal[])
    : (faalsRaw as Faal[]);

const cors: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
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

function publicProfile(p: ProfileRow) {
  return {
    tgid: p.tgid,
    username: p.username,
    first_name: p.first_name,
    last_name: p.last_name,
    free_remaining: p.free_remaining,
    remained_hafez: p.remained_hafez,
    referral_code: p.referral_code,
    referred_by: p.referred_by,
    total_credit: (p.free_remaining || 0) + (p.remained_hafez || 0),
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
  const existing = await getProfile(env, user.tgid);
  const now = new Date().toISOString();

  if (existing) {
    await sb(env)
      .from("profile")
      .update({
        username: user.username ?? existing.username,
        first_name: user.first_name ?? existing.first_name,
        last_name: user.last_name ?? existing.last_name,
        last_visit: now,
      })
      .eq("tgid", user.tgid);
    return (await getProfile(env, user.tgid))!;
  }

  const row = {
    tgid: user.tgid,
    username: user.username || null,
    first_name: user.first_name || null,
    last_name: user.last_name || null,
    free_remaining: 5,
    remained_hafez: 0,
    referral_code: `H${user.tgid.toString(36).toUpperCase()}`,
    created_at: now,
    last_visit: now,
  };

  const { error } = await sb(env).from("profile").insert(row);
  if (error) throw error;
  return (await getProfile(env, user.tgid))!;
}

async function consumeCredit(env: Env, tgid: number) {
  const profile = await getProfile(env, tgid);
  if (!profile) {
    return { ok: false as const, error: "no_profile" as const, profile: null };
  }

  if (profile.remained_hafez > 0) {
    await sb(env)
      .from("profile")
      .update({
        remained_hafez: profile.remained_hafez - 1,
        last_visit: new Date().toISOString(),
      })
      .eq("tgid", tgid);
  } else if (profile.free_remaining > 0) {
    await sb(env)
      .from("profile")
      .update({
        free_remaining: profile.free_remaining - 1,
        last_visit: new Date().toISOString(),
      })
      .eq("tgid", tgid);
  } else {
    return { ok: false as const, error: "no_credit" as const, profile };
  }

  return {
    ok: true as const,
    profile: (await getProfile(env, tgid))!,
  };
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
  return res.json();
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
  const profile = await getProfile(env, tgid);
  if (!profile) throw new Error("no_profile");
  await sb(env)
    .from("profile")
    .update({
      remained_hafez: (profile.remained_hafez || 0) + grant,
      last_visit: new Date().toISOString(),
    })
    .eq("tgid", tgid);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/" || path === "/health") {
        const tgid = Number(url.searchParams.get("tgid") || 0);
        if (!tgid) {
          return json({ ok: true, service: "niat-hafez-api" });
        }

        const profile = await ensureProfile(env, {
          tgid,
          username: url.searchParams.get("username"),
          first_name:
            url.searchParams.get("fname") ||
            url.searchParams.get("first_name"),
          last_name:
            url.searchParams.get("lname") ||
            url.searchParams.get("last_name"),
        });

        return json({ ok: true, profile: publicProfile(profile) });
      }

      if (path === "/api/profile") {
        const tgid = Number(url.searchParams.get("tgid") || 0);
        if (!tgid) return json({ error: "tgid_required" }, 400);
        const profile = await getProfile(env, tgid);
        if (!profile) return json({ error: "not_found" }, 404);
        return json({ profile: publicProfile(profile) });
      }

      if (path === "/api/fal") {
        const tgid = Number(url.searchParams.get("tgid") || 0);
        if (!tgid) return json({ error: "tgid_required" }, 400);

        await ensureProfile(env, {
          tgid,
          username: url.searchParams.get("username"),
          first_name: url.searchParams.get("fname"),
          last_name: url.searchParams.get("lname"),
        });

        const spent = await consumeCredit(env, tgid);
        if (!spent.ok) {
          return json(
            {
              error: spent.error || "no_credit",
              profile: spent.profile ? publicProfile(spent.profile) : null,
            },
            402
          );
        }

        const faal = randomFaal();
        return json({
          faal,
          profile: publicProfile(spent.profile!),
        });
      }

      if (path === "/payments/packages") {
        return json({ packages: Object.values(PACKAGES) });
      }

      if (path === "/api/pay/create" && request.method === "POST") {
        const body = (await request.json()) as {
          tgid?: number;
          package_id?: string;
        };
        const tgid = Number(body.tgid || 0);
        const package_id = String(body.package_id || "");
        const pkg = PACKAGES[package_id];

        if (!tgid || !pkg) {
          return json({ error: "invalid_request" }, 400);
        }

        await ensureProfile(env, { tgid });

        const inv = await createBlupalInvoice(env, pkg.amount_rial);

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
        const payload = (await request.json()) as {
          event?: string;
          invoice_id?: number;
          status?: string;
        };

        if (payload.event !== "payment.completed" || !payload.invoice_id) {
          return json({ received: true });
        }

        const invoiceId = Number(payload.invoice_id);

        const { data: pay, error } = await sb(env)
          .from("invoice")
          .select("*")
          .eq("invoice_id", invoiceId)
          .maybeSingle();
        if (error) throw error;
        if (!pay) return json({ received: true, note: "unknown_invoice" });

        if (pay.status === "PAID") {
          return json({ received: true, note: "already_paid" });
        }

        const pkg = PACKAGES[pay.package_id];
        if (!pkg) return json({ received: true, note: "unknown_package" });

        await grantHafez(env, Number(pay.tgid), pkg.grant);

        const { error: upErr } = await sb(env)
          .from("invoice")
          .update({
            status: "PAID",
            paid_at: new Date().toISOString(),
          })
          .eq("invoice_id", invoiceId);
        if (upErr) throw upErr;

        return json({ received: true, granted: pkg.grant });
      }

      if (path === "/api/pay/status") {
        const invoiceId = Number(url.searchParams.get("invoice_id") || 0);
        if (!invoiceId) return json({ error: "invoice_id_required" }, 400);
        const { data: pay, error } = await sb(env)
          .from("payment")
          .select("invoice_id, status, package_id, tgid")
          .eq("invoice_id", invoiceId)
          .maybeSingle();
        if (error) throw error;
        if (!pay) return json({ error: "not_found" }, 404);
        return json(pay);
      }

      if (path === "/api/pay/reconcile" && request.method === "POST") {
        const body = (await request.json()) as { invoice_id?: number };
        const invoiceId = Number(body.invoice_id || 0);
        if (!invoiceId) return json({ error: "invoice_id_required" }, 400);

        const { data: pay, error } = await sb(env)
          .from("invoice") // or "payment" — same name as your table
          .select("*")
          .eq("invoice_id", invoiceId)
          .maybeSingle();
        if (error) throw error;
        if (!pay) return json({ error: "not_found" }, 404);
        if (pay.status === "PAID") return json({ status: "PAID", note: "already" });

        const res = await fetch(
          `https://blupal.top/api/v1/invoices/${invoiceId}`,
          { headers: { "X-API-Key": env.BLUPAL_API_KEY } }
        );
        const remote = await res.json();
        if (!res.ok || remote.status !== "PAID") {
          return json({ status: pay.status, remote: remote.status || remote });
        }

        const pkg = PACKAGES[pay.package_id];
        if (!pkg) return json({ error: "unknown_package" }, 400);

        await grantHafez(env, pay.tgid, pkg.grant);
        await sb(env)
          .from("invoice")
          .update({ status: "PAID", paid_at: new Date().toISOString() })
          .eq("invoice_id", invoiceId);

        return json({ status: "PAID", granted: pkg.grant });
      }

      return json({ error: "not_found" }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: "server_error", detail: String(e) }, 500);
    }
  },
};