// "control": lámpák és konnektorok távkapcsolása és időzítése (O2B). Supabase Edge Function (Deno).
//
// Hívások (POST, JSON):
//   { action: "switch", pink: "C3", on: true, confirm?: true }   a belépett felhasználó (Authorization: Bearer <JWT>)
//   { action: "scene", items: [["C3", true], ["C2", false]] }     egymás után, 3 mp-enként
//   { action: "tick" }                                            percenként a Supabase ütemezője (x-cron-key fejléc)
//
// Kapcsolási szabály (CLAUDE.md 9. fejezet): egyszerre egy parancs, két kapcsolás között legalább 3 mp:
// minden kapcsolás előtt a control_slot() adatbázis-függvény foglal helyet (sorzár, várakozással).
// Csak a CONTROL_PINKS listán lévő eszköz kapcsolható; a CONTROL_CONFIRM listán lévő (bojler) csak confirm: true-val.
// Titkok (a "Kapcsolás telepítése" workflow állítja be a GitHub Secretsből): TUYA_ACCESS_ID, TUYA_ACCESS_SECRET,
// TUYA_ENDPOINT, O2B_SECRET (a projekt titkos kulcsa), CONTROL_CRON_KEY. Válaszban és naplóban kulcs nem szerepel.

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("O2B_SECRET") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TUYA_ID = Deno.env.get("TUYA_ACCESS_ID") ?? "";
const TUYA_SECRET = Deno.env.get("TUYA_ACCESS_SECRET") ?? "";
const TUYA_EP = (Deno.env.get("TUYA_ENDPOINT") || "https://openapi.tuyaeu.com").replace(/\/$/, "");
const CRON_KEY = Deno.env.get("CONTROL_CRON_KEY") ?? "";
const PINKS: string[] = JSON.parse(Deno.env.get("CONTROL_PINKS") || "[]");
const CONFIRM: string[] = JSON.parse(Deno.env.get("CONTROL_CONFIRM") || "[]");
const LAT = Number(Deno.env.get("SITE_LAT") || "47.48"), LON = Number(Deno.env.get("SITE_LON") || "19.04");
const TZ = "Europe/Budapest";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---- Supabase REST (titkos kulccsal) ---------------------------------------------------------------
async function rest(method: string, path: string, body?: unknown, prefer = "") {
  const h: Record<string, string> = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: "application/json" };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (prefer) h["Prefer"] = prefer;
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`adatbázis ${r.status}`);
  return t ? JSON.parse(t) : null;
}

async function whoIs(req: Request): Promise<{ id: string; role: string } | null> {
  const auth = req.headers.get("authorization") || "";
  const tok = auth.replace(/^Bearer\s+/i, "");
  if (!tok || tok === SB_KEY) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${tok}` } });
  if (!r.ok) return null;
  const u = await r.json();
  if (!u?.id) return null;
  const rows = await rest("GET", `app_users?select=role&user_id=eq.${u.id}`);
  const role = rows?.[0]?.role;
  return role && ["owner", "cleaner", "viewer"].includes(role) ? { id: u.id, role } : null;
}

// ---- Tuya ----------------------------------------------------------------------------------------
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function sha256(s: string) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
async function hmac(s: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(TUYA_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(s))).toUpperCase();
}
let token = "", tokenExp = 0;
async function tuya(method: string, url: string, body?: unknown, withToken = true) {
  const data = body === undefined ? "" : JSON.stringify(body);
  const t = String(Date.now()), nonce = crypto.randomUUID().replace(/-/g, "");
  const sts = [method, await sha256(data), "", url].join("\n");
  const sign = await hmac(TUYA_ID + (withToken ? token : "") + t + nonce + sts);
  const h: Record<string, string> = { client_id: TUYA_ID, t, nonce, sign_method: "HMAC-SHA256", sign, "Content-Type": "application/json" };
  if (withToken) h.access_token = token;
  const r = await fetch(TUYA_EP + url, { method, headers: h, body: data || undefined });
  const p = await r.json();
  if (!p.success) throw new Error(`Tuya ${p.code ?? r.status}`);
  return p.result;
}
async function ensureToken() {
  if (token && Date.now() < tokenExp - 60000) return;
  token = "";
  const res = await tuya("GET", "/v1.0/token?grant_type=1", undefined, false);
  token = res.access_token; tokenExp = Date.now() + Number(res.expire_time || 3600) * 1000;
}

// ---- egy kapcsolás ---------------------------------------------------------------------------------
async function doSwitch(pink: string, on: boolean, source: string, userId: string | null, confirm = false) {
  if (!PINKS.includes(pink)) throw new Error("ez az eszköz nem kapcsolható");
  if (CONFIRM.includes(pink) && !confirm && (source === "user" || source === "scene")) throw new Error("megerősítés kell");
  const dev = (await rest("GET", `devices?select=tuya_device_id&pink=eq.${encodeURIComponent(pink)}`))?.[0];
  if (!dev?.tuya_device_id) throw new Error("az eszköz nincs párosítva");
  const latest = (await rest("GET", `device_latest?select=status&pink=eq.${encodeURIComponent(pink)}`))?.[0];
  const st = latest?.status || {};
  const code = "switch_1" in st ? "switch_1" : "switch" in st ? "switch" : "switch_1";
  let ok = false, note = "";
  try {
    await rest("POST", "rpc/control_slot", {});                 // 3 mp-es szünet, egyszerre egy parancs
    await ensureToken();
    await tuya("POST", `/v1.0/devices/${dev.tuya_device_id}/commands`, { commands: [{ code, value: on }] });
    ok = true;
    await rest("PATCH", `device_latest?pink=eq.${encodeURIComponent(pink)}`, { status: { ...st, [code]: on }, ts: new Date().toISOString() }, "return=minimal").catch(() => {});
  } catch (e) {
    note = String((e as Error).message || e).slice(0, 180);
  }
  await rest("POST", "control_log", [{ pink, action: on ? "on" : "off", source, user_id: userId, ok, note: note || null }], "return=minimal").catch(() => {});
  if (!ok) throw new Error(note || "a kapcsolás nem sikerült");
}

// ---- napkelte, napnyugta (NOAA-közelítés), budapesti idő -------------------------------------------
function sunMinutes(d: Date, kind: "sunrise" | "sunset"): number | null {
  const RAD = Math.PI / 180, day0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12);
  const T = (day0 / 864e5 + 2440587.5 - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360, M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
  const lam = L0 + C - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * T) * RAD);
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos((125.04 - 1934.136 * T) * RAD);
  const dec = Math.asin(Math.sin(eps * RAD) * Math.sin(lam * RAD));
  const y = Math.tan(eps * RAD / 2) ** 2;
  const eqt = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
  const cosH = (Math.cos(90.833 * RAD) - Math.sin(LAT * RAD) * Math.sin(dec)) / (Math.cos(LAT * RAD) * Math.cos(dec));
  if (cosH > 1 || cosH < -1) return null;
  const H = Math.acos(cosH) / RAD, noon = 720 - 4 * LON - eqt;
  const utcMin = kind === "sunrise" ? noon - 4 * H : noon + 4 * H;
  const at = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + utcMin * 60000);
  return local(at).min;
}
function local(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute), bit: 1 << wd };
}

async function tick() {
  const now = new Date(), L = local(now), done: string[] = [];
  const timers = await rest("GET", `control_timers?select=id,pink,action&due_at=lte.${now.toISOString()}&order=due_at.asc&limit=20`) || [];
  for (const t of timers) {
    await rest("DELETE", `control_timers?id=eq.${t.id}`).catch(() => {});
    try { await doSwitch(t.pink, t.action === "on", "timer", null); done.push(t.pink); } catch (_) { /* naplózva */ }
  }
  const rules = await rest("GET", "control_rules?select=id,pink,action,kind,minute,days,last_fired&enabled=is.true") || [];
  for (const r of rules) {
    if (!(r.days & L.bit) || r.last_fired === L.date) continue;
    let target = r.minute;
    if (r.kind !== "time") { const s = sunMinutes(now, r.kind); if (s == null) continue; target = s + r.minute; }
    if (L.min < target || L.min - target > 15) continue;           // 15 perces türelmi ablak (kimaradt perc)
    await rest("PATCH", `control_rules?id=eq.${r.id}`, { last_fired: L.date }, "return=minimal");
    try { await doSwitch(r.pink, r.action === "on", "rule", null); done.push(r.pink); } catch (_) { /* naplózva */ }
  }
  return done;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "csak POST" }, 405);
  let b: any = {};
  try { b = await req.json(); } catch (_) { /* üres */ }
  try {
    if (b.action === "tick") {
      if (!CRON_KEY || req.headers.get("x-cron-key") !== CRON_KEY) return json({ ok: false, error: "tiltott" }, 403);
      return json({ ok: true, done: (await tick()).length });
    }
    const who = await whoIs(req);
    if (!who) return json({ ok: false, error: "Jelentkezz be (vagy nincs hozzáférésed)." }, 401);
    if (b.action === "switch") {
      await doSwitch(String(b.pink), !!b.on, "user", who.id, !!b.confirm);
      return json({ ok: true, pink: b.pink, on: !!b.on });
    }
    if (b.action === "scene" && Array.isArray(b.items)) {
      const res: unknown[] = [];
      for (const [pink, on] of b.items.slice(0, 12)) {
        try { await doSwitch(String(pink), !!on, "scene", who.id, false); res.push([pink, true]); } catch (e) { res.push([pink, false, String((e as Error).message)]); }
      }
      return json({ ok: true, results: res });
    }
    return json({ ok: false, error: "ismeretlen kérés" }, 400);
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) }, 400);
  }
});
