import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import routes from "./routes";
import mobileRoutes from "./routes/mobile";
import { errorHandler, notFound } from "./middleware/auth";
import { AppError } from "./utils/app-error";
import { swaggerSpec } from "./config/swagger";

const app = express();

const allowedOrigins = env.clientUrl.split(",").map((o) => o.trim()).filter(Boolean);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // Allow Swagger UI to load its own scripts/styles
    contentSecurityPolicy: false,
  })
);
app.use(
  cors({
    origin: (origin, callback) => {
      const isDev = env.nodeEnv !== "production";
      if (
        !origin ||
        isDev ||
        allowedOrigins.includes(origin) ||
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:") ||
        origin.endsWith(".vercel.app") ||
        origin.includes("trackle-fleet") ||
        origin.includes("trackfleet")
      ) {
        return callback(null, true);
      }
      return callback(new AppError(`Origin ${origin} not allowed by CORS`, 403));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept", "X-Requested-With"],
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));

// ─── Root ────────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "TrackFleet API",
    version: "1.0.0",
    docs: "/api/docs",
  });
});

// ─── Swagger UI via CDN (works on Vercel serverless) ────────────────────────
// swagger-ui-express static assets don't work on Vercel (wrong MIME type).
// Instead we serve a slim HTML page that loads Swagger UI from unpkg CDN.
app.get("/api/docs", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TrackFleet API Docs</title>
    <meta name="description" content="TrackFleet GPS Fleet Tracking API documentation" />
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      .swagger-ui .topbar { background: #0f172a; }
      .swagger-ui .topbar .download-url-wrapper { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui-bundle.js"></script>
    <script src="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui-standalone-preset.js"></script>
    <script>
      window.onload = function () {
        SwaggerUIBundle({
          url: "/api/docs.json",
          dom_id: "#swagger-ui",
          deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
          layout: "StandaloneLayout",
          persistAuthorization: true,
          displayRequestDuration: true,
          filter: true,
          tryItOutEnabled: true,
        });
      };
    </script>
  </body>
</html>`);
});

// Expose raw OpenAPI JSON (for Swagger UI + Postman import)
app.get("/api/docs.json", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

import gpsRoutes from "./routes/gps.routes";

// ─── API Routes ──────────────────────────────────────────────────────────────
app.use("/api/gps", gpsRoutes);
app.use("/api/mobile", mobileRoutes);
app.use("/api", routes);

app.use(notFound);
app.use(errorHandler);

export default app;
