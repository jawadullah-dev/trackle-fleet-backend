import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { Role, Notification } from "@prisma/client";
import { verifyToken, JwtPayload } from "../utils/auth";
import { env } from "../config/env";
import { prisma } from "../config/db";

export interface AuthenticatedSocket extends Socket {
  data: {
    user?: JwtPayload;
  };
}

let io: Server | null = null;

export function initSocketServer(httpServer: HttpServer): Server {
  const allowedOrigins = env.clientUrl
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        const isDev = env.nodeEnv !== "production";
        if (
          !origin ||
          allowedOrigins.includes(origin) ||
          isDev ||
          origin.startsWith("http://localhost:") ||
          origin.startsWith("http://127.0.0.1:") ||
          origin.endsWith(".vercel.app") ||
          origin.includes("trackle-fleet") ||
          origin.includes("trackfleet")
        ) {
          return callback(null, true);
        }
        return callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH"],
    },
    // Accept both polling and websocket — polling works on Vercel serverless.
    // Clients connecting via polling-first will still get real-time events via
    // HTTP long-polling. Pure WebSocket connections are also accepted for
    // self-hosted / non-serverless environments.
    transports: ["polling", "websocket"],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.use((socket: Socket, next) => {
    try {
      const authHeader =
        socket.handshake.auth?.token || socket.handshake.headers.authorization;

      if (!authHeader) {
        return next(new Error("Authentication error: No token provided"));
      }

      const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : authHeader;

      const decoded = verifyToken(token);
      (socket as AuthenticatedSocket).data.user = decoded;
      next();
    } catch (err) {
      console.warn("[Socket.IO] Auth failed:", (err as Error).message);
      return next(new Error("Authentication error: Invalid or expired token"));
    }
  });

  io.on("connection", (socket: AuthenticatedSocket) => {
    const user = socket.data.user;
    if (!user) return;

    console.log(
      `[Socket.IO] User connected: ${user.email} (${user.role}) [ID: ${socket.id}]`
    );

    // Join personal user room
    socket.join(`user:${user.sub}`);

    // Join role-specific room
    if (user.role === Role.SUPER_ADMIN) {
      socket.join("role:SUPER_ADMIN");
    } else if (user.role === Role.COMPANY_ADMIN) {
      socket.join("role:COMPANY_ADMIN");
      if (user.companyId) {
        socket.join(`company:${user.companyId}`);
      }
    }

    /**
     * GPS Device → Server → Admin Dashboard
     *
     * A GPS device (connected via the mobile app or direct socket) emits this
     * event to update the vehicle's live position. The server:
     *   1. Persists a GpsPoint row (for history replay)
     *   2. Updates Vehicle.latitude/longitude/status/lastUpdate
     *   3. Broadcasts vehicle:location to the company room so the admin map
     *      refreshes in real-time without polling.
     *
     * Payload: { deviceId, latitude, longitude, speed?, recordedAt? }
     */
    socket.on(
      "gps:update",
      async (payload: {
        deviceId: string;
        latitude: number;
        longitude: number;
        speed?: number | null;
        recordedAt?: string;
      }) => {
        try {
          const { processGpsPing } = await import("./gps-ingest.service");
          await processGpsPing(payload);
        } catch (err) {
          console.error("[Socket.IO] gps:update error:", err);
        }
      }
    );

    socket.on("disconnect", (reason) => {
      console.log(
        `[Socket.IO] User disconnected: ${user.email} (${reason})`
      );
    });
  });

  console.log("[Socket.IO] Real-time notification + GPS tracking server initialized");
  return io;
}

export function getIO(): Server | null {
  return io;
}

export function emitNotification(notification: Notification) {
  if (!io) {
    console.warn("[Socket.IO] Not initialized, cannot emit notification");
    return;
  }

  // Super admins see all platform notifications
  io.to("role:SUPER_ADMIN").emit("notification:new", notification);

  // Company admins see their company notifications
  if (notification.companyId) {
    io.to(`company:${notification.companyId}`).emit(
      "notification:new",
      notification
    );
  }

  // Specific user notifications
  if (notification.userId) {
    io.to(`user:${notification.userId}`).emit("notification:new", notification);
  }

  console.log(
    `[Socket.IO] Emitted notification ${notification.id} ("${notification.title}")`
  );
}

export function emitNotificationRead(notificationId: string) {
  if (!io) return;
  io.emit("notification:read", { id: notificationId });
}

export function emitAllNotificationsRead(
  userId?: string,
  companyId?: string | null
) {
  if (!io) return;
  io.emit("notification:all_read", { userId, companyId });
}

export async function createAndEmitNotification(data: {
  title: string;
  body: string;
  userId?: string | null;
  companyId?: string | null;
}) {
  const notification = await prisma.notification.create({
    data: {
      title: data.title,
      body: data.body,
      userId: data.userId ?? null,
      companyId: data.companyId ?? null,
    },
  });

  emitNotification(notification);
  return notification;
}

