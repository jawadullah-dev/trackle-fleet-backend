import http from "http";
import app from "./app";
import { env } from "./config/env";
import { ensureSuperAdmin } from "./services/auth.service";
import { initSocketServer } from "./services/socket.service";

async function bootstrap() {
  try {
    await ensureSuperAdmin();
    console.log(`Super admin ready: ${env.superAdminEmail}`);
  } catch (error) {
    console.warn("Could not ensure super admin (DB may not be connected yet):", error);
  }

  const httpServer = http.createServer(app);
  initSocketServer(httpServer);

  httpServer.listen(env.port, () => {
    console.log(`TrackFleet API & WebSocket running on http://localhost:${env.port}`);
  });
}

bootstrap();
