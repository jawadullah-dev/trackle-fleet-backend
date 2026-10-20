import http from "http";
import app from "./app";
import { env } from "./config/env";
import { ensureSuperAdmin } from "./services/auth.service";
import { initSocketServer } from "./services/socket.service";
import { startGpsTcpServer } from "./gps/tcpServer";
import { startStaleVehicleChecker } from "./services/gps-ingest.service";

async function bootstrap() {
  try {
    await ensureSuperAdmin();
    console.log(`Super admin ready: ${env.superAdminEmail}`);
  } catch (error) {
    console.warn("Could not ensure super admin (DB may not be connected yet):", error);
  }

  const httpServer = http.createServer(app);
  initSocketServer(httpServer);

  // Start Hardware GPS Tracker TCP listener (supports GT06, H02, Coban)
  try {
    startGpsTcpServer();
  } catch (err: any) {
    console.warn("Could not start GPS TCP server:", err.message);
  }

  // Start periodic offline updater for stale vehicles
  try {
    startStaleVehicleChecker();
  } catch (err: any) {
    console.warn("Could not start stale vehicle checker:", err.message);
  }

  // Start GPS51 Cloud Live Sync (polls real-time vehicle positions from gps51.com every 1s)
  try {
    const { startGps51SyncService } = require("./services/gps51-sync.service");
    startGps51SyncService(1);
  } catch (err: any) {
    console.warn("Could not start GPS51 Cloud sync service:", err.message);
  }

  httpServer.listen(env.port, () => {
    console.log(`TrackFleet API & WebSocket running on http://localhost:${env.port}`);
  });
}

bootstrap();
