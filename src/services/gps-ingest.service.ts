import { prisma } from "../config/db";
import { getIO } from "./socket.service";

export interface GpsPingInput {
  deviceId: string;
  latitude: number;
  longitude: number;
  speed?: number | null;
  heading?: number | null;
  isValid?: boolean;
  recordedAt?: string | Date;
}

export interface GpsPingResult {
  success: boolean;
  vehicleId?: string;
  vehicleName?: string;
  regNo?: string;
  companyId?: string;
  error?: string;
  pointId?: string;
}

/**
 * Calculates the distance between two coordinates in kilometers (Haversine formula).
 */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// In-memory throttling map to prevent database point flooding: vehicleId -> timestamp (ms)
const lastSavedPointTime = new Map<string, number>();
const STORAGE_THROTTLE_MS = 3000; // Save at most 1 point per 3 seconds per vehicle

/**
 * Ingests a single GPS ping from any source:
 * - TCP GPS Tracker listener (H02 / GT06 / Coban)
 * - REST Telemetry endpoint (/api/gps/track)
 * - WebSocket gps:update event
 * - Simulator script
 */
export async function processGpsPing(ping: GpsPingInput): Promise<GpsPingResult> {
  const cleanDeviceId = String(ping.deviceId || "").trim();
  if (!cleanDeviceId) {
    return { success: false, error: "Missing deviceId" };
  }

  // 1. Drop invalid fixes (lat/lng 0,0 or GPS flag = void)
  if (ping.isValid === false) {
    return {
      success: false,
      error: `Dropped void/invalid GPS fix for device "${cleanDeviceId}"`,
    };
  }

  const lat = Number(ping.latitude);
  const lng = Number(ping.longitude);

  if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return {
      success: false,
      error: `Invalid coordinates (lat=${lat}, lng=${lng}) for device "${cleanDeviceId}"`,
    };
  }

  // 2. Device-to-vehicle matching: look up vehicle by deviceId (supports phone number variants for JT808)
  const candidateIds = [cleanDeviceId];
  if (cleanDeviceId.startsWith("0")) {
    candidateIds.push(cleanDeviceId.replace(/^0+/, ""));
  } else {
    candidateIds.push("0" + cleanDeviceId);
  }

  const vehicle = await prisma.vehicle.findFirst({
    where: {
      OR: candidateIds.map((id) => ({
        deviceId: { equals: id, mode: "insensitive" },
      })),
    },
    select: {
      id: true,
      name: true,
      regNo: true,
      type: true,
      companyId: true,
      status: true,
      latitude: true,
      longitude: true,
      currentKm: true,
    },
  });

  if (!vehicle) {
    // Log as unregistered device and ignore the data (do not crash, do not store)
    console.warn(`[GPS Ingest] Unregistered tracker device ID "${cleanDeviceId}" - ignoring ping`);
    return {
      success: false,
      error: `Unregistered device ID "${cleanDeviceId}". Please add a vehicle with this Device ID in the dashboard.`,
    };
  }

  const recordedAt = ping.recordedAt ? new Date(ping.recordedAt) : new Date();
  const speed = typeof ping.speed === "number" && !isNaN(ping.speed) ? Math.max(0, ping.speed) : 0;
  const heading = typeof ping.heading === "number" && !isNaN(ping.heading) ? (Math.round(ping.heading) % 360 + 360) % 360 : 0;

  // Calculate increment in odometer if previous coordinates exist
  let kmIncrement = 0;
  if (vehicle.latitude != null && vehicle.longitude != null) {
    const delta = haversineKm(vehicle.latitude, vehicle.longitude, lat, lng);
    // Ignore GPS jitter under 10 meters (0.01 km) or impossible jumps > 150 km in a single ping
    if (delta > 0.01 && delta < 150) {
      kmIncrement = Math.round(delta);
    }
  }

  // 3. Throttle storage: write to GpsPoint table at most once every few seconds
  const now = Date.now();
  const lastSaved = lastSavedPointTime.get(vehicle.id) || 0;
  let savedPointId: string | undefined = undefined;

  if (now - lastSaved >= STORAGE_THROTTLE_MS) {
    try {
      const point = await prisma.gpsPoint.create({
        data: {
          vehicleId: vehicle.id,
          latitude: lat,
          longitude: lng,
          speed,
          recordedAt,
        },
      });
      savedPointId = point.id;
      lastSavedPointTime.set(vehicle.id, now);
    } catch (err: any) {
      console.warn(`[GPS Ingest] Could not save GpsPoint:`, err.message);
    }
  }

  // 4. Update Vehicle live coordinates, status and last seen
  const wasOffline = vehicle.status === "OFFLINE";
  await prisma.vehicle.update({
    where: { id: vehicle.id },
    data: {
      latitude: lat,
      longitude: lng,
      status: "ONLINE",
      lastUpdate: recordedAt,
      currentKm: {
        increment: kmIncrement,
      },
    },
  });

  // 5. Emit real-time WebSocket update strictly to company room
  const io = getIO();
  if (io) {
    const locationUpdate = {
      id: vehicle.id,
      vehicleId: vehicle.id,
      name: vehicle.name,
      regNo: vehicle.regNo,
      type: vehicle.type,
      status: "ONLINE" as const,
      lat,
      latitude: lat,
      lng,
      longitude: lng,
      speed: Math.round(speed),
      heading,
      timestamp: recordedAt.toISOString(),
      lastUpdate: recordedAt.toISOString(),
      companyId: vehicle.companyId,
    };

    // Scoped strictly to the company admin room
    io.to(`company:${vehicle.companyId}`).emit("vehicle:location", locationUpdate);

    // If vehicle flipped from OFFLINE to ONLINE, emit vehicle:status update
    if (wasOffline) {
      io.to(`company:${vehicle.companyId}`).emit("vehicle:status", {
        id: vehicle.id,
        vehicleId: vehicle.id,
        status: "ONLINE",
        timestamp: recordedAt.toISOString(),
      });
    }
  }

  return {
    success: true,
    vehicleId: vehicle.id,
    vehicleName: vehicle.name,
    regNo: vehicle.regNo,
    companyId: vehicle.companyId,
    pointId: savedPointId,
  };
}

/**
 * Background interval job: flips vehicles with no updates in > 2 minutes to OFFLINE
 * and broadcasts vehicle:status to company room.
 */
let staleCheckerInterval: NodeJS.Timeout | null = null;

export function startStaleVehicleChecker(intervalMs = 30000): void {
  if (staleCheckerInterval) return;

  staleCheckerInterval = setInterval(async () => {
    try {
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

      // Find all vehicles currently ONLINE whose lastUpdate is older than 2 minutes
      const staleVehicles = await prisma.vehicle.findMany({
        where: {
          status: "ONLINE",
          lastUpdate: {
            lt: twoMinutesAgo,
          },
        },
        select: {
          id: true,
          companyId: true,
          name: true,
        },
      });

      if (staleVehicles.length > 0) {
        // Mark stale vehicles as OFFLINE
        const staleIds = staleVehicles.map((v) => v.id);
        await prisma.vehicle.updateMany({
          where: {
            id: { in: staleIds },
          },
          data: {
            status: "OFFLINE",
          },
        });

        const io = getIO();
        for (const v of staleVehicles) {
          console.log(`[GPS Ingest] Vehicle "${v.name}" (${v.id}) timed out -> marked OFFLINE`);
          if (io) {
            io.to(`company:${v.companyId}`).emit("vehicle:status", {
              id: v.id,
              vehicleId: v.id,
              status: "OFFLINE",
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    } catch (err: any) {
      console.warn("[GPS Ingest] Stale vehicle check error:", err.message);
    }
  }, intervalMs);

  console.log(`⏱️ Stale vehicle offline checker active (interval: ${intervalMs / 1000}s, threshold: 2m)`);
}

export function stopStaleVehicleChecker(): void {
  if (staleCheckerInterval) {
    clearInterval(staleCheckerInterval);
    staleCheckerInterval = null;
  }
}
