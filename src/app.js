// src/app.js
const express = require("express");
const cors = require("cors");
const pino = require("pino");
const pinoHttp = require("pino-http");

const webhookRouter = require("./routes/webhook");
const apiRouter = require("./routes/api");

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  // Redacta Authorization en TODOS los logs (request/response)
  redact: {
    paths: ["req.headers.authorization", "res.headers.authorization"],
    censor: "[redacted]",
  },
});

const app = express();

// Detrás de proxy (Railway / Nginx) -> IP real y esquema HTTPS correctos
app.set("trust proxy", 1);

// Logger HTTP
app.use(pinoHttp({ logger }));

// CORS abierto para FileMaker (puedes restringirlo por ORIGIN si quieres)
app.use(cors());
app.options("*", cors());

// Body parser JSON
app.use(express.json({ limit: "1mb" }));

// Healthcheck
app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Rutas principales
app.use("/meli/webhook", webhookRouter);
app.use("/meli", apiRouter);

// 404: no encontrada
app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

// Manejo centralizado de errores
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message = status >= 500 ? "Internal Server Error" : err.message;

  if (req.log) {
    req.log.error({ err, status }, "request failed");
  } else {
    logger.error({ err, status }, "request failed");
  }

  res.status(status).json({ error: message });
});

module.exports = app;
