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
  motionStatus?: "PARKED" | "IDLE" | "RUNNING" | "OFFLINE";
  engineOn?: boolean;
  /** When false, store/update coords but keep vehicle OFFLINE (e.g. GPS51 last-known). Default true. */
  markOnline?: boolean;
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

// In-memory motion status cache: "PARKED" (Red) | "IDLE" (Blue) | "RUNNING" (Green) | "OFFLINE" (Grey)
const latestMotionStatus = new Map<string, "PARKED" | "IDLE" | "RUNNING" | "OFFLINE">();

export function getVehicleMotionStatus(vehicleId: string): "PARKED" | "IDLE" | "RUNNING" | "OFFLINE" {
  return latestMotionStatus.get(vehicleId) || "PARKED";
}

/** Drop cached device→vehicle mapping after catalog sync / upsert. */
export function invalidateVehicleDeviceCache(deviceId?: string): void {
  if (!deviceId) {
    vehicleDeviceCache.clear();
    return;
  }
  const clean = String(deviceId).trim();
  for (const key of vehicleDeviceCache.keys()) {
    if (key === clean || key.includes(clean) || clean.includes(key)) {
      vehicleDeviceCache.delete(key);
    }
  }
}


// In-memory device-to-vehicle cache to prevent DB hammering on every ping
interface CachedVehicle {
  id: string;
  name: string;
  regNo: string;
  type: string;
  companyId: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  currentKm: number;
  cachedAt: number;
}

const vehicleDeviceCache = new Map<string, CachedVehicle>();
const VEHICLE_CACHE_TTL_MS = 60000; // 60 seconds

async function resolveVehicle(cleanDeviceId: string): Promise<CachedVehicle | null> {
  const cached = vehicleDeviceCache.get(cleanDeviceId);
  if (cached && Date.now() - cached.cachedAt < VEHICLE_CACHE_TTL_MS) {
    return cached;
  }

  const candidateIds = [cleanDeviceId];
  if (cleanDeviceId.startsWith("0")) {
    candidateIds.push(cleanDeviceId.replace(/^0+/, ""));
  } else {
    candidateIds.push("0" + cleanDeviceId);
  }

  // Handle 15-digit IMEI vs 12-digit JT808 BCD phone number
  if (cleanDeviceId.length === 15) {
    candidateIds.push(cleanDeviceId.slice(-12));
    candidateIds.push(cleanDeviceId.slice(-11));
    candidateIds.push("0" + cleanDeviceId.slice(-11));
  } else if (cleanDeviceId.length === 12) {
    candidateIds.push("868" + cleanDeviceId);
    candidateIds.push(cleanDeviceId.slice(-11));
  }

  // Helper with 1 retry for transient DB pool disconnects
  async function queryDb() {
    return prisma.vehicle.findFirst({
      where: {
        OR: [
          ...candidateIds.map((id) => ({
            deviceId: { equals: id, mode: "insensitive" as const },
          })),
          ...candidateIds.map((id) => ({
            deviceId: { contains: id, mode: "insensitive" as const },
          })),
        ],
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
  }

  let vehicle: any = null;
  try {
    vehicle = await queryDb();
  } catch (err) {
    // Retry once if connection dropped
    try {
      vehicle = await queryDb();
    } catch {
      vehicle = null;
    }
  }

  // If no vehicle matched by ID, check if there is only 1 vehicle in the database as fallback
  if (!vehicle) {
    try {
      const totalVehicles = await prisma.vehicle.count();
      if (totalVehicles === 1) {
        vehicle = await prisma.vehicle.findFirst({
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
        if (vehicle) {
          console.log(
            `[GPS Ingest] Auto-mapped hardware tracker ID "${cleanDeviceId}" to vehicle "${vehicle.name}" (${vehicle.id})`
          );
        }
      }
    } catch (err: any) {
      console.warn(`[GPS Ingest] DB lookup fallback error:`, err.message);
    }
  }

  if (vehicle) {
    const entry: CachedVehicle = { ...vehicle, cachedAt: Date.now() };
    vehicleDeviceCache.set(cleanDeviceId, entry);
    return entry;
  }

  return null;
}

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

  // 2. Resolve vehicle via cache + database
  const vehicle = await resolveVehicle(cleanDeviceId);

  if (!vehicle) {
    // Log as unregistered device and ignore the data (do not crash, do not store)
    console.warn(`[GPS Ingest] Unregistered tracker device ID "${cleanDeviceId}" - ignoring ping`);
    return {
      success: false,
      error: `Unregistered device ID "${cleanDeviceId}". Please add a vehicle with this Device ID in the dashboard.`,
    };
  }

  const receivedAt = new Date();
  let recordedAt = ping.recordedAt ? new Date(ping.recordedAt) : receivedAt;
  if (Number.isNaN(recordedAt.getTime())) recordedAt = receivedAt;
  // Clamp absurd device clocks; keep trail timestamps sane for history
  if (recordedAt.getTime() > receivedAt.getTime() + 60_000) recordedAt = receivedAt;
  if (recordedAt.getTime() < receivedAt.getTime() - 7 * 24 * 60 * 60 * 1000) {
    // Older than 7 days — still store for history, but treat receive time for liveness
  }

  const markOnline = ping.markOnline !== false && ping.motionStatus !== "OFFLINE";
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

  // 3. Persist trail points for history polylines.
  // Always save the first point, then throttle — but still save when the vehicle
  // moved meaningfully (>15m) so slow GPS51 polls never skip the route.
  const now = Date.now();
  const lastSaved = lastSavedPointTime.get(vehicle.id) || 0;
  const movedEnough =
    vehicle.latitude == null ||
    vehicle.longitude == null ||
    haversineKm(vehicle.latitude, vehicle.longitude, lat, lng) >= 0.015;
  const shouldStorePoint =
    lastSaved === 0 ||
    now - lastSaved >= STORAGE_THROTTLE_MS ||
    (movedEnough && now - lastSaved >= 1000);

  let savedPointId: string | undefined = undefined;

  if (shouldStorePoint) {
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

  // 4. Update Vehicle live coordinates / status.
  // lastUpdate uses receive time so stale-checker is not fooled by old device clocks.
  const wasOffline = vehicle.status === "OFFLINE";
  const nextStatus = markOnline ? "ONLINE" : "OFFLINE";
  vehicle.latitude = lat;
  vehicle.longitude = lng;
  vehicle.status = nextStatus;
  vehicle.cachedAt = Date.now();

  try {
    await prisma.vehicle.update({
      where: { id: vehicle.id },
      data: {
        latitude: lat,
        longitude: lng,
        status: nextStatus,
        lastUpdate: markOnline ? receivedAt : recordedAt,
        currentKm: {
          increment: kmIncrement,
        },
      },
    });
  } catch (err: any) {
    console.warn(`[GPS Ingest] Transient DB error updating vehicle coordinates:`, err.message);
  }

  // 5. Update in-memory motion status and emit real-time WebSocket update strictly to company room
  const resolvedMotionStatus =
    ping.motionStatus ||
    (!markOnline ? "OFFLINE" : speed > 2 ? "RUNNING" : "PARKED");
  latestMotionStatus.set(vehicle.id, resolvedMotionStatus);

  const io = getIO();
  if (io) {
    const locationUpdate = {
      id: vehicle.id,
      vehicleId: vehicle.id,
      name: vehicle.name,
      regNo: vehicle.regNo,
      type: vehicle.type,
      status: nextStatus as "ONLINE" | "OFFLINE",
      motionStatus: resolvedMotionStatus,
      engineOn: ping.engineOn ?? (resolvedMotionStatus === "RUNNING" || resolvedMotionStatus === "IDLE"),
      lat,
      latitude: lat,
      lng,
      longitude: lng,
      speed: Math.round(speed),
      heading,
      timestamp: receivedAt.toISOString(),
      lastUpdate: receivedAt.toISOString(),
      companyId: vehicle.companyId,
    };

    // Scoped strictly to the company admin room
    io.to(`company:${vehicle.companyId}`).emit("vehicle:location", locationUpdate);

    if (wasOffline && markOnline) {
      io.to(`company:${vehicle.companyId}`).emit("vehicle:status", {
        id: vehicle.id,
        vehicleId: vehicle.id,
        status: "ONLINE",
        motionStatus: resolvedMotionStatus,
        timestamp: receivedAt.toISOString(),
      });
    } else if (!wasOffline && !markOnline) {
      io.to(`company:${vehicle.companyId}`).emit("vehicle:status", {
        id: vehicle.id,
        vehicleId: vehicle.id,
        status: "OFFLINE",
        motionStatus: "OFFLINE",
        timestamp: receivedAt.toISOString(),
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

  const timeoutMinutes = Math.max(1, Number(process.env.STALE_TIMEOUT_MINUTES || 10));

  staleCheckerInterval = setInterval(async () => {
    try {
      const staleThreshold = new Date(Date.now() - timeoutMinutes * 60 * 1000);

      // Find all vehicles currently ONLINE whose lastUpdate is older than staleThreshold
      const staleVehicles = await prisma.vehicle.findMany({
        where: {
          status: "ONLINE",
          lastUpdate: {
            lt: staleThreshold,
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
          latestMotionStatus.set(v.id, "OFFLINE");
          console.log(`[GPS Ingest] Vehicle "${v.name}" (${v.id}) timed out (> ${timeoutMinutes}m) -> marked OFFLINE`);
          if (io) {
            io.to(`company:${v.companyId}`).emit("vehicle:status", {
              id: v.id,
              vehicleId: v.id,
              status: "OFFLINE",
              motionStatus: "OFFLINE",
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    } catch (err: any) {
      console.warn("[GPS Ingest] Stale vehicle check error:", err.message);
    }
  }, intervalMs);

  console.log(`⏱️ Stale vehicle offline checker active (interval: ${intervalMs / 1000}s, threshold: ${timeoutMinutes}m)`);
}

export function stopStaleVehicleChecker(): void {
  if (staleCheckerInterval) {
    clearInterval(staleCheckerInterval);
    staleCheckerInterval = null;
  }
}
