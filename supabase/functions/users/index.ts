// "users": felhasználók kezelése a térképről (F27 és O2B; mindkét projektbe telepítve). Supabase Edge Function (Deno).
//
// Csak a tulaj (app_users.role = 'owner') hívhatja, a belépett munkamenetével (Authorization: Bearer <JWT>).
//   { action: "list" }                                                  felhasználók: név, e-mail, szerepkör, utolsó belépés
//   { action: "create", email, name, role, password }                   új fiók (vagy meglévő e-mailhez szerepkör)
//   { action: "update", user_id, name?, role?, password? }              név, szerepkör, új jelszó
//   { action: "remove", user_id }                                       fiók törlése
// Szerepkör: member (családtag: lát és az O2B-ben kapcsol), viewer (csak lát), cleaner (takarító).
// Tulajt nem lehet létrehozni, módosítani vagy törölni, és a tulaj a saját fiókját sem rontja el.
// Titok: USERS_SECRET (a projekt titkos kulcsa, a "Hozzáférés telepítése" workflow állítja be).
// Válaszban és naplóban kulcs, jelszó nem szerepel.

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("USERS_SECRET") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ROLES = ["member", "viewer", "cleaner"];
const EMAIL = /^[^\s@<>()"',;:]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const fail = (msg: string, status = 400) => json({ ok: false, error: msg }, status);

function hdr(extra: Record<string, string> = {}) {
  return { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: "application/json", ...extra };
}
async function rest(method: string, path: string, body?: unknown, prefer = "") {
  const h = hdr(body === undefined ? {} : { "Content-Type": "application/json" });
  if (prefer) (h as Record<string, string>)["Prefer"] = prefer;
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`adatbázis ${r.status}`);
  return t ? JSON.parse(t) : null;
}
async function admin(method: string, path: string, body?: unknown) {
  const r = await fetch(`${SB_URL}/auth/v1/admin/${path}`, {
    method, headers: hdr(body === undefined ? {} : { "Content-Type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  let j: any = null;
  try { j = t ? JSON.parse(t) : null; } catch { j = null; }
  return { ok: r.ok, status: r.status, data: j };
}

async function whoIs(req: Request): Promise<{ id: string; role: string } | null> {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok || tok === SB_KEY) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${tok}` } });
  if (!r.ok) return null;
  const u = await r.json();
  if (!u?.id) return null;
  const rows = await rest("GET", `app_users?select=role&user_id=eq.${encodeURIComponent(u.id)}`);
  return rows?.[0]?.role ? { id: u.id, role: rows[0].role } : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function cleanName(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 40);
  return s || null;
}
function checkPass(p: unknown): string | null {
  if (typeof p !== "string") return "Adj meg jelszót.";
  if (p.length < 10) return "A jelszó legalább 10 karakter legyen.";
  if (p.length > 72) return "A jelszó legfeljebb 72 karakter lehet.";
  return null;
}

async function listUsers() {
  const roles: any[] = await rest("GET", "app_users?select=*");
  const byId: Record<string, any> = {};
  for (let page = 1; page <= 5; page++) {
    const r = await admin("GET", `users?page=${page}&per_page=200`);
    if (!r.ok) throw new Error(`auth ${r.status}`);
    const us = r.data?.users || [];
    for (const u of us) byId[u.id] = u;
    if (us.length < 200) break;
  }
  const out = roles.map((x) => {
    const u = byId[x.user_id] || {};
    return { user_id: x.user_id, role: x.role, name: x.name ?? null, email: u.email ?? "", last_sign_in_at: u.last_sign_in_at ?? null, created_at: x.created_at };
  });
  // belépni tudó, de szerepkör nélküli fiókok (pl. a Supabase felületén létrehozott): a tulaj itt adhat nekik szerepet
  const known = new Set(roles.map((x) => x.user_id));
  for (const u of Object.values(byId)) {
    if (!known.has(u.id)) out.push({ user_id: u.id, role: null, name: u.user_metadata?.name ?? null, email: u.email ?? "", last_sign_in_at: u.last_sign_in_at ?? null, created_at: u.created_at });
  }
  return out;
}

async function target(id: unknown, me: string) {
  if (typeof id !== "string" || !UUID.test(id)) return { err: "Hibás felhasználó-azonosító." };
  if (id === me) return { err: "A saját tulaj fiókodat itt nem módosíthatod." };
  const rows = await rest("GET", `app_users?select=role&user_id=eq.${id}`);
  if (rows?.[0]?.role === "owner") return { err: "Tulaj fiókot itt nem lehet módosítani." };
  return { role: rows?.[0]?.role ?? null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("Csak POST.", 405);
  if (!SB_URL || !SB_KEY) return fail("A függvény nincs beállítva.", 500);
  let body: any = {};
  try { body = await req.json(); } catch { return fail("Hibás kérés."); }
  let me;
  try { me = await whoIs(req); } catch { return fail("Az adatbázis most nem érhető el.", 503); }
  if (!me) return fail("Lépj be.", 401);
  if (me.role !== "owner") return fail("Felhasználókat csak a tulaj kezelhet.", 403);
  try {
    const a = body.action;
    if (a === "list") return json({ ok: true, users: await listUsers() });

    if (a === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const name = cleanName(body.name);
      const role = String(body.role || "");
      if (!EMAIL.test(email)) return fail("Adj meg egy érvényes e-mail címet.");
      if (!name) return fail("Adj meg nevet.");
      if (!ROLES.includes(role)) return fail("Válassz szerepkört.");
      const pe = checkPass(body.password);
      if (pe) return fail(pe);
      let id = "";
      const c = await admin("POST", "users", { email, password: body.password, email_confirm: true, user_metadata: { name } });
      if (c.ok && c.data?.id) id = c.data.id;
      else if (c.status === 422 || c.status === 400) {
        // már van ilyen fiók: szerepkört kap, a jelszava nem változik
        const all = await listUsers();
        const ex = all.find((u) => (u.email || "").toLowerCase() === email);
        if (!ex) return fail("A fiókot nem sikerült létrehozni.");
        if (ex.role === "owner" || ex.user_id === me.id) return fail("Ez a tulaj fiókja.");
        id = ex.user_id;
      } else return fail("A fiókot nem sikerült létrehozni.", 502);
      await rest("POST", "app_users?on_conflict=user_id", { user_id: id, role, name }, "resolution=merge-duplicates,return=minimal");
      return json({ ok: true, user_id: id, existed: !(c.ok && c.data?.id) });
    }

    if (a === "update") {
      const t = await target(body.user_id, me.id);
      if (t.err) return fail(t.err);
      const patch: Record<string, unknown> = {};
      if ("name" in body) { const n = cleanName(body.name); if (!n) return fail("A név nem lehet üres."); patch.name = n; }
      if ("role" in body) { if (!ROLES.includes(String(body.role))) return fail("Ismeretlen szerepkör."); patch.role = String(body.role); }
      if (body.password != null && body.password !== "") {
        const pe = checkPass(body.password);
        if (pe) return fail(pe);
        const p = await admin("PUT", `users/${body.user_id}`, { password: body.password });
        if (!p.ok) return fail("A jelszót nem sikerült beállítani.", 502);
        // a régi jelszóval nyitott munkamenetek (más eszközök) is záruljanak le
        await rest("POST", "rpc/admin_end_sessions", { p_user: body.user_id }).catch(() => null);
      }
      if (Object.keys(patch).length) {
        if (t.role) await rest("PATCH", `app_users?user_id=eq.${body.user_id}`, patch, "return=minimal");
        else {
          if (!patch.role) return fail("Válassz szerepkört.");
          await rest("POST", "app_users?on_conflict=user_id", { user_id: body.user_id, ...patch }, "resolution=merge-duplicates,return=minimal");
        }
      }
      return json({ ok: true });
    }

    if (a === "remove") {
      const t = await target(body.user_id, me.id);
      if (t.err) return fail(t.err);
      await rest("DELETE", `app_users?user_id=eq.${body.user_id}`, undefined, "return=minimal");
      const d = await admin("DELETE", `users/${body.user_id}`);
      if (!d.ok && d.status !== 404) return fail("A hozzáférés megszűnt, de a fiókot nem sikerült törölni.", 502);
      return json({ ok: true });
    }
    return fail("Ismeretlen művelet.");
  } catch (_e) {
    return fail("Hiba történt, próbáld újra.", 500);
  }
});
