// src/routes/api.js
const express = require("express");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

const {
  meliClient,
  getOrdersBySeller,
  getShipment,
  getLabelPdf,
  // si tu lib/meli.js NO exporta getUsersMe aún, este alias quedará undefined
  getUsersMe: getUsersMeMaybe,
} = require("../lib/meli");

const { isUnshipped, isWithinWindow } = require("../lib/filters");

const router = express.Router();

dayjs.extend(utc);
dayjs.extend(timezone);

// ---- Configuración ----
const DEFAULT_DATE_WINDOW_HOURS =
  Number.parseInt(process.env.DATE_WINDOW_HOURS, 10) || 72;
const DEFAULT_UNSHIPPED_STATUSES = ["ready_to_ship", "to_be_picked_up"];
const SERVICE_TZ = process.env.TZ || "America/Santiago";

function loadStatuses() {
  const raw = process.env.UNSHIPPED_STATUSES;
  if (!raw) return DEFAULT_UNSHIPPED_STATUSES;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0
      ? parsed
      : DEFAULT_UNSHIPPED_STATUSES;
  } catch {
    return DEFAULT_UNSHIPPED_STATUSES;
  }
}

const ALLOWED_STATUSES = loadStatuses();

// ---- Utilidades ----
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function extractAccessToken(req) {
  const authHeader = req.get("Authorization");
  if (!authHeader) throw new HttpError(401, "Missing Authorization header");
  const [scheme, token] = authHeader.split(" ");
  if (!token || scheme.toLowerCase() !== "bearer") {
    throw new HttpError(401, "Authorization header must be a Bearer token");
  }
  return token.trim();
}

function resolveDateRange(queryFrom, queryTo) {
  const now = dayjs().tz(SERVICE_TZ);
  let fromDate = null;
  let toDate = null;

  if (queryFrom) {
    const parsedFrom = dayjs.tz(queryFrom, SERVICE_TZ);
    if (!parsedFrom.isValid())
      throw new HttpError(400, "Invalid from parameter");
    fromDate = parsedFrom;
  }

  if (queryTo) {
    const parsedTo = dayjs.tz(queryTo, SERVICE_TZ);
    if (!parsedTo.isValid()) throw new HttpError(400, "Invalid to parameter");
    toDate = parsedTo;
  }

  if (!fromDate && !toDate) {
    toDate = now;
    fromDate = now.subtract(DEFAULT_DATE_WINDOW_HOURS, "hour");
  } else if (fromDate && !toDate) {
    toDate = fromDate.add(DEFAULT_DATE_WINDOW_HOURS, "hour");
  } else if (!fromDate && toDate) {
    fromDate = toDate.subtract(DEFAULT_DATE_WINDOW_HOURS, "hour");
  }

  if (fromDate.isAfter(toDate)) {
    throw new HttpError(400, "`from` must be earlier than `to`");
  }

  return {
    fromDate,
    toDate,
    fromISO: fromDate.toISOString(),
    toISO: toDate.toISOString(),
  };
}

async function resolveSellerId(client) {
  try {
    if (typeof getUsersMeMaybe === "function") {
      const me = await getUsersMeMaybe(client, {
        backoff: { baseDelayMs: 300 },
      });
      return me?.id;
    }
    // Fallback si todavía no exportaste getUsersMe en lib/meli.js
    const { data } = await client.get("/users/me");
    return data?.id;
  } catch {
    throw new HttpError(502, "Could not resolve seller id from token");
  }
}

async function fetchPaidOrders(client, sellerId, fromISO, toISO, log) {
  const limit = 50;
  let offset = 0;
  const orders = [];
  const fromDate = dayjs.tz(fromISO, SERVICE_TZ);
  const toDate = dayjs.tz(toISO, SERVICE_TZ);

  // Paginación segura con tope
  while (true) {
    const data = await getOrdersBySeller(
      client,
      {
        sellerId, // usar el ID real del vendedor
        status: "paid",
        sort: "date_desc",
        limit,
        offset,
        from: fromISO,
        to: toISO,
      },
      { backoff: { baseDelayMs: 300 } }
    );

    const page = Array.isArray(data.results) ? data.results : [];
    if (page.length === 0) break;

    for (const order of page) {
      const created = order.date_created
        ? dayjs(order.date_created).tz(SERVICE_TZ)
        : null;
      if (!created || created.isBefore(fromDate) || created.isAfter(toDate))
        continue;

      // (Opcional) usar el helper de ventana si prefieres
      // if (!isWithinWindow(order.date_created, DEFAULT_DATE_WINDOW_HOURS, SERVICE_TZ)) continue;

      orders.push(order);
    }

    if (page.length < limit) break;

    offset += page.length;

    if (data.paging && typeof data.paging.total === "number") {
      const { total } = data.paging;
      if (offset >= total) break;
    }

    if (offset >= 500) {
      if (log && typeof log.warn === "function") {
        log.warn({ offset }, "stopping pagination after scanning 500 orders");
      }
      break;
    }
  }

  return orders;
}

// ---- Rutas ----
router.get("/orders/unshipped", async (req, res, next) => {
  try {
    const accessToken = extractAccessToken(req);
    const { fromISO, toISO } = resolveDateRange(req.query.from, req.query.to);

    const client = meliClient(accessToken);

    // quién soy? (seller id real según token)
    const sellerId = await resolveSellerId(client);
    if (!sellerId) throw new HttpError(502, "Seller id not found for token");

    const orders = await fetchPaidOrders(
      client,
      sellerId,
      fromISO,
      toISO,
      req.log
    );

    const results = [];
    for (const order of orders) {
      const shipmentId = order?.shipping?.id;
      if (!shipmentId) continue;

      let shipment;
      try {
        shipment = await getShipment(client, shipmentId, {
          backoff: { baseDelayMs: 300 },
        });
      } catch (error) {
        if (error.response && error.response.status === 404) {
          if (req.log && typeof req.log.warn === "function") {
            req.log.warn({ shipmentId }, "shipment not found");
          }
          continue;
        }
        throw error;
      }

      if (!shipment || !isUnshipped(shipment.status, ALLOWED_STATUSES))
        continue;

      const primaryItem =
        Array.isArray(order.order_items) && order.order_items.length > 0
          ? order.order_items[0]
          : null;

      results.push({
        order_id: order.id ?? null,
        date_created: order.date_created ?? null,
        buyer: {
          id: order?.buyer?.id ?? null,
          nickname: order?.buyer?.nickname ?? null,
        },
        title: primaryItem?.item?.title ?? null,
        quantity: primaryItem?.quantity ?? null,
        unit_price: primaryItem?.unit_price ?? null,
        shipment_id: shipment.id ?? shipmentId,
        shipment_status: shipment.status ?? null,
      });
    }

    res.json(results);
  } catch (error) {
    next(error);
  }
});

router.get("/labels/:shipment_id", async (req, res, next) => {
  try {
    const accessToken = extractAccessToken(req);
    const { shipment_id: shipmentId } = req.params;
    if (!shipmentId) throw new HttpError(400, "shipment_id is required");

    const client = meliClient(accessToken);
    const stream = await getLabelPdf(client, shipmentId, {
      backoff: { baseDelayMs: 300 },
    });

    res.set("Content-Type", "application/pdf");
    res.set(
      "Content-Disposition",
      `inline; filename="shipment_${shipmentId}.pdf"`
    );
    res.set("Cache-Control", "no-store");

    stream.on("error", (streamErr) => {
      streamErr.status = streamErr.status || 502;
      next(streamErr);
    });

    stream.pipe(res);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
