// src/routes/webhook.js
const express = require("express");

const { dedupeByOrderId } = require("../lib/filters");

const router = express.Router();

// Buffer circular en memoria (sin DB)
const RING_BUFFER_SIZE = Number(process.env.WEBHOOK_BUFFER_SIZE || 500);
const ringBuffer = [];

/** Inserta evento en buffer (expulsa el más antiguo si se llena) */
function pushEvent(event) {
  if (ringBuffer.length >= RING_BUFFER_SIZE) {
    ringBuffer.shift();
  }
  ringBuffer.push(event);
}

/** Extrae el último número del path (ej: "/orders/1234567890?foo=bar" -> "1234567890") */
function parseResourceId(resource) {
  if (!resource || typeof resource !== "string") return null;
  const m = resource.match(/\/(\d+)(?:\?.*)?$/);
  return m ? m[1] : null;
}

/**
 * Webhook de Mercado Libre
 * Guardamos SOLO órdenes (orders_v2) en el buffer, con { order_id, seller_id, ts }
 */
router.post("/", (req, res) => {
  const {
    topic = null,
    user_id = null,
    resource = null,
    id = null,
  } = req.body || {};

  if (topic !== "orders_v2") {
    // Mantenerlo simple: ignoramos otros topics
    if (req.log && typeof req.log.info === "function") {
      req.log.info({ topic }, "webhook ignored (not orders_v2)");
    }
    return res.status(200).json({ ok: true });
  }

  const orderId = id || parseResourceId(resource);
  const entry = {
    ts: new Date().toISOString(),
    topic: "orders_v2",
    seller_id: user_id || null,
    order_id: orderId || null,
  };

  // Guardar solo si hay order_id y seller_id
  if (entry.order_id && entry.seller_id) {
    pushEvent(entry);
    if (req.log && typeof req.log.info === "function") {
      req.log.info({ event: entry }, "webhook stored");
    }
  } else if (req.log && typeof req.log.warn === "function") {
    req.log.warn({ raw: req.body }, "webhook missing order_id or seller_id");
  }

  // Siempre responder rápido
  res.status(200).json({ ok: true });
});

/**
 * Ver últimos eventos (no destructivo)
 * GET /meli/webhook/events
 * Devuelve TODOS los eventos del buffer (más recientes primero), sin filtros.
 */
router.get("/events", (req, res) => {
  const items = ringBuffer.slice().reverse(); // más recientes primero
  const deduped = dedupeByOrderId(items);
  res.json(deduped);
});

/**
 * Consumir y borrar eventos (destructivo) con DEDUP por order_id
 * GET /meli/webhook/consume
 * Devuelve [{ order_id, seller_id, ts }, ...] (únicos por order_id, tomando el más reciente)
 * y luego elimina del buffer TODOS los eventos de esos order_id (incluye duplicados).
 */
router.get("/consume", (req, res) => {
  const candidates = ringBuffer
    .slice()
    .reverse()
    .filter((e) => e.topic === "orders_v2" && e.order_id && e.seller_id);

  const out = dedupeByOrderId(candidates);

  const idsToPurge = new Set(out.map((e) => String(e.order_id)));
  const kept = [];
  for (const e of ringBuffer) {
    const oid = e.order_id ? String(e.order_id) : null;
    if (oid && idsToPurge.has(oid)) continue; // purgar
    kept.push(e);
  }
  ringBuffer.length = 0;
  for (const e of kept) ringBuffer.push(e);

  res.json(out);
});

/**
 * Limpiar el buffer manualmente (opcional)
 * DELETE /meli/webhook/events
 */
router.delete("/events", (req, res) => {
  ringBuffer.length = 0;
  res.json({ ok: true, cleared: true });
});

module.exports = router;
