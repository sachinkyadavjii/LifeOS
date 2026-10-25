import { buildPushPayload } from "@block65/webcrypto-web-push";

const reminderNames = new Set(["Start day", "Study", "Meal", "Workout", "Review", "Bedtime"]);

function corsHeaders(origin, env) {
  return {
    "Access-Control-Allow-Origin": origin || env.APP_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function json(data, status, origin, env) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(origin, env) },
  });
}
function validDeviceId(value) { return typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value); }
function validPushEndpoint(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (
      host === "fcm.googleapis.com" ||
      host === "updates.push.services.mozilla.com" ||
      host === "push.services.mozilla.com" ||
      host === "web.push.apple.com" ||
      host.endsWith(".notify.windows.com")
    );
  } catch { return false; }
}
function validTime(value) { return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
function validZone(value) {
  if (typeof value !== "string" || value.length > 80) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}
async function secretHash(secret) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function authenticate(request, env) {
  const token = request.headers.get("Authorization") || "";
  if (!token.startsWith("Bearer ")) return null;
  const parts = token.slice(7).split(".");
  if (parts.length !== 2 || !validDeviceId(parts[0]) || parts[1].length < 40) return null;
  const hash = await secretHash(parts[1]);
  const row = await env.DB.prepare("SELECT device_id FROM devices WHERE device_id = ? AND secret_hash = ?")
    .bind(parts[0], hash).first();
  return row ? { deviceId: parts[0], secret: parts[1] } : null;
}
function getLocalTime(date, timeZone) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const hour = values.hour === "24" ? "00" : values.hour;
  return { date: values.year + "-" + values.month + "-" + values.day, time: hour + ":" + values.minute };
}
async function sendPush(env, device, title, body, tag) {
  const subscription = {
    endpoint: device.endpoint,
    expirationTime: device.expiration_time,
    keys: JSON.parse(device.keys_json),
  };
  const payload = await buildPushPayload({
    data: JSON.stringify({ title: title, body: body, tag: tag, url: env.APP_ORIGIN + "/LifeOS/" }),
    options: { ttl: 3600, urgency: "high", topic: (tag || "lifeos").slice(0, 32) },
  }, subscription, {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  });
  return await fetch(device.endpoint, payload);
}
async function removeDevice(env, deviceId) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM reminders WHERE device_id = ?").bind(deviceId),
    env.DB.prepare("DELETE FROM devices WHERE device_id = ?").bind(deviceId),
  ]);
}
async function handleRequest(request, env) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== env.APP_ORIGIN) return json({ error: "Origin not allowed." }, 403, origin, env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin, env) });

  const url = new URL(request.url);
  if (url.pathname === "/api/config" && request.method === "GET") {
    return json({ vapidPublicKey: env.VAPID_PUBLIC_KEY }, 200, origin, env);
  }

  if (url.pathname === "/api/subscribe" && request.method === "POST") {
    let data;
    try { data = await request.json(); } catch { return json({ error: "Invalid JSON." }, 400, origin, env); }
    const deviceId = data.deviceId;
    const deviceSecret = data.deviceSecret;
    const subscription = data.subscription;
    const timeZone = validZone(data.timeZone) ? data.timeZone : "UTC";
    if (!validDeviceId(deviceId) || typeof deviceSecret !== "string" || deviceSecret.length < 40 || deviceSecret.length > 128) {
      return json({ error: "Invalid device credentials." }, 400, origin, env);
    }
    if (!subscription || typeof subscription.endpoint !== "string" || !validPushEndpoint(subscription.endpoint) ||
        !subscription.keys || typeof subscription.keys.p256dh !== "string" || typeof subscription.keys.auth !== "string") {
      return json({ error: "Invalid push subscription." }, 400, origin, env);
    }
    const existing = await env.DB.prepare("SELECT secret_hash FROM devices WHERE device_id = ?").bind(deviceId).first();
    const hash = await secretHash(deviceSecret);
    if (existing && existing.secret_hash !== hash) return json({ error: "Device authorization failed." }, 401, origin, env);
    const statement = env.DB.prepare(
      "INSERT INTO devices (device_id, secret_hash, endpoint, expiration_time, keys_json, time_zone, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET endpoint=excluded.endpoint, " +
      "expiration_time=excluded.expiration_time, keys_json=excluded.keys_json, time_zone=excluded.time_zone"
    ).bind(deviceId, hash, subscription.endpoint, subscription.expirationTime || null, JSON.stringify(subscription.keys), timeZone, new Date().toISOString());
    await statement.run();
    return json({ ok: true }, 201, origin, env);
  }

  if (url.pathname === "/api/reminders" && request.method === "PUT") {
    const auth = await authenticate(request, env);
    if (!auth) return json({ error: "Device authorization failed. Enable notifications again." }, 401, origin, env);
    let data;
    try { data = await request.json(); } catch { return json({ error: "Invalid JSON." }, 400, origin, env); }
    if (!Array.isArray(data.reminders) || data.reminders.length > reminderNames.size) {
      return json({ error: "Invalid reminder list." }, 400, origin, env);
    }
    const timeZone = validZone(data.timeZone) ? data.timeZone : "UTC";
    const rows = [];
    for (const reminder of data.reminders) {
      if (!reminderNames.has(reminder.name) || !validTime(reminder.time)) {
        return json({ error: "Invalid reminder name or time." }, 400, origin, env);
      }
      rows.push(env.DB.prepare(
        "INSERT INTO reminders (device_id, name, time, enabled, last_sent_date) VALUES (?, ?, ?, ?, NULL) " +
        "ON CONFLICT(device_id, name) DO UPDATE SET " +
        "last_sent_date=CASE WHEN reminders.time != excluded.time OR reminders.enabled != excluded.enabled THEN NULL ELSE reminders.last_sent_date END, " +
        "time=excluded.time, enabled=excluded.enabled"
      ).bind(auth.deviceId, reminder.name, reminder.time, reminder.on ? 1 : 0));
    }
    await env.DB.prepare("UPDATE devices SET time_zone = ? WHERE device_id = ?").bind(timeZone, auth.deviceId).run();
    if (rows.length) await env.DB.batch(rows);
    return json({ ok: true, synced: rows.length }, 200, origin, env);
  }

  if (url.pathname === "/api/test" && request.method === "POST") {
    const auth = await authenticate(request, env);
    if (!auth) return json({ error: "Device authorization failed." }, 401, origin, env);
    const device = await env.DB.prepare("SELECT * FROM devices WHERE device_id = ?").bind(auth.deviceId).first();
    try {
      const result = await sendPush(env, device, "Nitya test notification", "Push notifications are connected on this device.", "lifeos-test");
      if (result.status === 404 || result.status === 410) await removeDevice(env, auth.deviceId);
      if (!result.ok) return json({ error: "Push service returned " + result.status + "." }, 502, origin, env);
      return json({ ok: true }, 200, origin, env);
    } catch (error) {
      return json({ error: "Could not send the test notification." }, 502, origin, env);
    }
  }

  if (url.pathname === "/api/unsubscribe" && request.method === "DELETE") {
    const auth = await authenticate(request, env);
    if (!auth) return json({ error: "Device authorization failed." }, 401, origin, env);
    await removeDevice(env, auth.deviceId);
    return json({ ok: true }, 200, origin, env);
  }
  return json({ error: "Not found." }, 404, origin, env);
}

async function runScheduled(env) {
  const rows = await env.DB.prepare(
    "SELECT d.device_id, d.endpoint, d.expiration_time, d.keys_json, d.time_zone, " +
    "r.name, r.time, r.last_sent_date FROM reminders r JOIN devices d ON d.device_id = r.device_id WHERE r.enabled = 1"
  ).all();
  const now = new Date();
  for (const row of rows.results || []) {
    let local;
    try { local = getLocalTime(now, row.time_zone || "UTC"); } catch { local = getLocalTime(now, "UTC"); }
    if (row.time !== local.time || row.last_sent_date === local.date) continue;
    try {
      const device = { device_id: row.device_id, endpoint: row.endpoint, expiration_time: row.expiration_time, keys_json: row.keys_json };
      const result = await sendPush(env, device, "Nitya reminder", row.name, "lifeos-" + row.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
      if (result.status === 404 || result.status === 410) {
        await removeDevice(env, row.device_id);
      } else if (result.ok) {
        await env.DB.prepare("UPDATE reminders SET last_sent_date = ? WHERE device_id = ? AND name = ?")
          .bind(local.date, row.device_id, row.name).run();
      } else {
        console.error("Push delivery failed with status " + result.status);
      }
    } catch (error) {
      console.error("Reminder delivery failed", error);
    }
  }
}

export default {
  async fetch(request, env) {
    try { return await handleRequest(request, env); }
    catch (error) {
      console.error("LifeOS push request failed", error);
      const origin = request.headers.get("Origin");
      return json({ error: "The push service could not complete the request." }, 500, origin, env);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(env));
  },
};