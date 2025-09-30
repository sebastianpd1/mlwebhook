const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

function resolveTz(tz) {
  return tz || process.env.TZ || dayjs.tz.guess();
}

function toNumberHours(hours, fallback = 72) {
  const n = Number(hours);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isWithinWindow(dateISO, hours, tz) {
  if (!dateISO || typeof dateISO !== "string") return false;

  const referenceTz = resolveTz(tz);
  const h = toNumberHours(hours);
  const now = dayjs().tz(referenceTz);
  const start = now.subtract(h, "hour");

  const target = dayjs(dateISO).tz(referenceTz);
  if (!target.isValid()) return false;

  // Si quieres estricto al pasado, usa: target.isAfter(start) && target.isBefore(now)
  return target.isAfter(start) && target.isBefore(now.add(1, "minute"));
}

function isUnshipped(status, allowedStatuses = []) {
  if (
    !status ||
    !Array.isArray(allowedStatuses) ||
    allowedStatuses.length === 0
  )
    return false;
  // Normalización ligera por si llega con mayúsculas
  const s = String(status).toLowerCase();
  const allow = allowedStatuses.map((x) => String(x).toLowerCase());
  return allow.includes(s);
}

/**
 * Elimina notificaciones duplicadas tomando el order_id más reciente.
 * Mantiene el orden original del arreglo dado (más nuevos primero si ya venía así).
 */
function dedupeByOrderId(events) {
  if (!Array.isArray(events) || events.length === 0) return [];

  const seen = new Set();
  const deduped = [];

  for (const event of events) {
    if (!event || typeof event !== "object") continue;

    const rawId =
      event.order_id ??
      event.orderId ??
      (event.topic === "orders_v2" && event.id ? event.id : null);

    const key = rawId ? String(rawId) : null;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    deduped.push(event);
  }

  return deduped;
}

module.exports = {
  isWithinWindow,
  isUnshipped,
  dedupeByOrderId,
};
