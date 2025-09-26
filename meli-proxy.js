#!/usr/bin/env node
/* meli-proxy launcher */

if (process.env.NODE_ENV !== "production") {
  try {
    require("dotenv").config();
  } catch (_) {
    // dotenv es opcional en producción
  }
}

// Fijar TZ si no viene definida (útil para logs y Date)
process.env.TZ = process.env.TZ || "America/Santiago";

const pino = require("pino");
const app = require("./src/app");

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

const portEnv = process.env.PORT;
const port = Number.isFinite(Number.parseInt(portEnv, 10))
  ? Number(portEnv)
  : 3000;

const server = app.listen(port, () => {
  logger.info(
    { port, env: process.env.NODE_ENV || "development" },
    "meli-proxy listening"
  );
});

// Ajustes de timeouts para proxies / clients (mantener headersTimeout > keepAliveTimeout)
server.keepAliveTimeout = 61_000; // ms
server.headersTimeout = 65_000; // ms

server.on("error", (err) => {
  logger.error({ err }, "http server error");
  process.exitCode = 1;
});

// Manejo de errores no capturados
process.on("unhandledRejection", (reason, p) => {
  logger.error({ reason }, "unhandledRejection");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "uncaughtException");
  // En producción puedes optar por reiniciar el proceso:
  // process.exit(1);
});

// Apagado ordenado
function shutdown(signal) {
  logger.info({ signal }, "shutting down");
  const killTimer = setTimeout(() => {
    logger.warn("force exit after graceful timeout");
    process.exit(1);
  }, 10_000); // 10s de gracia
  killTimer.unref();

  server.close((err) => {
    if (err) {
      logger.error({ err }, "error while closing server");
      process.exit(1);
      return;
    }
    logger.info("server closed gracefully");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
