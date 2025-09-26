# meli-proxy

Mercado Libre proxy tailored for FileMaker integrations. It exposes lightweight webhook and REST endpoints that forward requests to Mercado Libre using the caller-provided OAuth token. No credentials or persistent storage are kept on the server, making it a good fit for Railway deployments.

## Features

- Node.js 18 + Express service with CORS enabled for FileMaker clients.
- Minimal proxy helpers for Mercado Libre orders, shipments, and PDF labels.
- Automatic exponential backoff on 429/5xx responses.
- In-memory webhook ring buffer (500 events) for troubleshooting.
- Pino structured logging ready for production use.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the environment example and adjust as needed:
   ```bash
   cp .env.example .env
   ```
3. Run locally:
   ```bash
   npm start
   ```

### Environment Variables

| Name | Description | Default |
| ---- | ----------- | ------- |
| `PORT` | HTTP port to bind. | `3000` |
| `TZ` | Timezone used for date windows and defaults. | `America/Santiago` |
| `UNSHIPPED_STATUSES` | JSON array of shipment statuses considered “pending shipment”. | `["ready_to_ship","to_be_picked_up"]` |
| `DATE_WINDOW_HOURS` | Hours to subtract from `to` when `from` is omitted. | `72` |
| `LOG_LEVEL` | Pino log level. | `info` |

Set `process.env.NODE_ENV=production` on Railway to skip `.env` loading.

## Deployment on Railway

1. Create a new Node.js service and connect this repository.
2. Railway auto-detects `npm start` as the start command. Make sure `PORT` and `TZ` variables are configured in Railway’s dashboard.
3. After deployment, set your Mercado Libre application webhook URL to:
   ```
   https://YOUR-RAILWAY-URL/meli/webhook
   ```
4. Re-deploy when configuration changes.

## API

All endpoints expect a valid Mercado Libre bearer token supplied via the `Authorization: Bearer <token>` header. Tokens are never stored on the proxy.

### `GET /health`
Returns `{ ok: true, time: <ISO> }` for monitoring.

### `POST /meli/webhook`
Receives Mercado Libre notifications and stores the last 500 events in memory. Responds immediately with `{ ok: true }`. No outbound calls are made here.

### `GET /meli/webhook/events`
Optional debug endpoint that returns up to the 200 most recent webhook entries (most recent first).

### `GET /meli/orders/unshipped?from=ISO&to=ISO`
- At least one of `from` or `to` is required.
- Defaults: `to = now`, `from = to - DATE_WINDOW_HOURS`.
- Queries Mercado Libre for paid orders (`/orders/search?seller=me`) and filters shipments by `UNSHIPPED_STATUSES`.
- Response shape:
  ```json
  [
    {
      "order_id": "123",
      "date_created": "2025-09-25T12:34:56.000-04:00",
      "buyer": { "id": "456", "nickname": "buyer" },
      "title": "Awesome Product",
      "quantity": 1,
      "unit_price": 19990,
      "shipment_id": "789",
      "shipment_status": "ready_to_ship"
    }
  ]
  ```

### `GET /meli/labels/:shipment_id`
Streams the PDF returned by `/marketplace/shipments/{id}/labels`. Remember to set `Accept: application/pdf` in your client.

## FileMaker Usage

Use FileMaker’s `Insert From URL` script step with the Mercado Libre OAuth token stored in `$token`.

### Orders
```
Insert from URL [ $json ;
  "https://YOUR-RAILWAY-URL/meli/orders/unshipped?from=2025-09-25T00:00:00&to=2025-09-25T23:59:59" ;
  cURL: "-X GET --header \"Authorization: Bearer " & $token & "\" --header \"Accept: application/json\""
]
```

### Label PDF
```
Insert from URL [ VENTAS_ML::EtiquetaPDF ;
  "https://YOUR-RAILWAY-URL/meli/labels/" & $shipment_id ;
  cURL: "-X GET --header \"Authorization: Bearer " & $token & "\" --header \"Accept: application/pdf\"" ;
  Verify SSL Certificates ; With dialog: Off
]
```

## Notes

- The webhook buffer clears on restart. Request the desired date window again to rebuild local state.
- Avoid hard-coding tokens; always pass the latest bearer token in each request.
- Customize `UNSHIPPED_STATUSES` if Mercado Libre introduces new statuses relevant to your workflow.
