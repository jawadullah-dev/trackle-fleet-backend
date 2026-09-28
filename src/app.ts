import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import routes from "./routes";
import mobileRoutes from "./routes/mobile";
import { errorHandler, notFound } from "./middleware/auth";
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
        allowedOrigins.includes(origin) ||
        isDev ||
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:")
      ) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
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

// ─── Swagger UI (works on Vercel) ────────────────────────────────────────────
app.use(
  "/api/docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: "TrackFleet API Docs",
    customfavIcon: "",
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      tryItOutEnabled: true,
    },
  })
);

// Expose raw OpenAPI JSON (useful for Postman import)
app.get("/api/docs.json", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

// ─── API Routes ──────────────────────────────────────────────────────────────
app.use("/api", routes);
app.use("/api/mobile", mobileRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
