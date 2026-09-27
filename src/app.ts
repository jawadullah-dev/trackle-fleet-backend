import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import routes from "./routes";
import { errorHandler, notFound } from "./middleware/auth";

const app = express();

const allowedOrigins = env.clientUrl.split(",").map((o) => o.trim()).filter(Boolean);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
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

app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "TrackFleet API",
    version: "1.0.0",
  });
});

app.use("/api", routes);
app.use(notFound);
app.use(errorHandler);

export default app;
