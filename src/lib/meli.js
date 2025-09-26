// src/lib/meli.js
const axios = require("axios");
const { withBackoff } = require("./backoff");

const API_BASE_URL = "https://api.mercadolibre.com";

function meliClient(accessToken) {
  if (!accessToken) throw new Error("Access token is required");
  return axios.create({
    baseURL: API_BASE_URL,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "meli-proxy/1.0 (+Railway)",
    },
    timeout: 15000,
  });
}

function resolveClient(clientOrToken) {
  if (!clientOrToken) throw new Error("Access token or client is required");
  return typeof clientOrToken === "string"
    ? meliClient(clientOrToken)
    : clientOrToken;
}

async function getUsersMe(clientOrToken, options = {}) {
  const client = resolveClient(clientOrToken);
  const response = await withBackoff(
    () => client.get("/users/me"),
    options.backoff || {}
  );
  return response.data;
}

async function getOrder(clientOrToken, orderId, options = {}) {
  if (!orderId) throw new Error("orderId is required");
  const client = resolveClient(clientOrToken);
  const response = await withBackoff(
    () => client.get(`/orders/${orderId}`),
    options.backoff || {}
  );
  return response.data;
}

async function getShipment(clientOrToken, shipmentId, options = {}) {
  if (!shipmentId) throw new Error("shipmentId is required");
  const client = resolveClient(clientOrToken);
  const response = await withBackoff(
    () => client.get(`/shipments/${shipmentId}`),
    options.backoff || {}
  );
  return response.data;
}

async function getOrdersBySeller(clientOrToken, query = {}, options = {}) {
  const client = resolveClient(clientOrToken);
  const params = {};
  const { sellerId, status, sort, limit, offset, from, to } = query;

  if (sellerId) params.seller = sellerId;
  if (status) params["order.status"] = status;
  if (sort) params.sort = sort;
  if (typeof limit === "number") params.limit = limit;
  if (typeof offset === "number") params.offset = offset;
  if (from) params["order.date_created.from"] = from;
  if (to) params["order.date_created.to"] = to;

  const response = await withBackoff(
    () => client.get("/orders/search", { params }),
    options.backoff || {}
  );
  return response.data; // tu ruta leerá data.results
}

async function getLabelPdf(clientOrToken, shipmentId, options = {}) {
  if (!shipmentId) throw new Error("shipmentId is required");
  const client = resolveClient(clientOrToken);
  const requestConfig = {
    responseType: "stream",
    headers: { Accept: "application/pdf" },
    timeout: 30000,
  };
  const response = await withBackoff(
    () =>
      client.get(`/marketplace/shipments/${shipmentId}/labels`, requestConfig),
    options.backoff || {}
  );
  return response.data; // stream
}

module.exports = {
  meliClient,
  getUsersMe,
  getOrder,
  getShipment,
  getOrdersBySeller,
  getLabelPdf,
};
