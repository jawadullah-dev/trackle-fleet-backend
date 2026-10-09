import { prisma } from "../config/db";
import { getIO } from "./socket.service";

export interface GpsPingInput {
  deviceId: string;
  latitude: number;
  longitude: number;
  speed?: number | null;
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
function haversineKm(
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

/**
 * Ingests a single GPS ping from any source:
 * - Coban GPS-403 hardware TCP listener
 * - HTTP telemetry endpoint (REST / Webhook)
 * - WebSocket gps:update event
 * - Dashboard simulation / test tool
 */
export async function processGpsPing(ping: GpsPingInput): Promise<GpsPingResult> {
  const cleanDeviceId = String(ping.deviceId || "").trim();
  if (!cleanDeviceId) {
    return { success: false, error: "Missing deviceId" };
  }

  const lat = Number(ping.latitude);
  const lng = Number(ping.longitude);

  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { success: false, error: "Invalid latitude or longitude" };
  }

  // Find vehicle by deviceId (exact or case-insensitive)
  const vehicle = await prisma.vehicle.findFirst({
    where: {
      deviceId: {
        equals: cleanDeviceId,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      name: true,
      regNo: true,
      type: true,
      companyId: true,
      latitude: true,
      longitude: true,
      currentKm: true,
    },
  });

  if (!vehicle) {
    return {
      success: false,
      error: `No vehicle found with Device ID / IMEI "${cleanDeviceId}". Please add this vehicle in the dashboard.`,
    };
  }

  const recordedAt = ping.recordedAt ? new Date(ping.recordedAt) : new Date();
  const speed = typeof ping.speed === "number" && !isNaN(ping.speed) ? Math.max(0, ping.speed) : 0;

  // Calculate increment in odometer if previous coordinates exist
  let kmIncrement = 0;
  if (vehicle.latitude != null && vehicle.longitude != null) {
    const delta = haversineKm(vehicle.latitude, vehicle.longitude, lat, lng);
    // Ignore GPS jitter under 10 meters (0.01 km) or impossible jumps > 150 km in a single ping
    if (delta > 0.01 && delta < 150) {
      kmIncrement = Math.round(delta);
    }
  }

  // 1. Store in GpsPoint table (for route history playback)
  const point = await prisma.gpsPoint.create({
    data: {
      vehicleId: vehicle.id,
      latitude: lat,
      longitude: lng,
      speed,
      recordedAt,
    },
  });

  // 2. Update Vehicle live coordinates, status and last update
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

  // 3. Emit real-time WebSocket update to Company Admin and Super Admin
  const io = getIO();
  if (io) {
    const locationUpdate = {
      id: vehicle.id,
      name: vehicle.name,
      regNo: vehicle.regNo,
      type: vehicle.type,
      status: "ONLINE" as const,
      latitude: lat,
      longitude: lng,
      speed: Math.round(speed),
      lastUpdate: recordedAt.toISOString(),
      companyId: vehicle.companyId,
    };

    // Real-time location is strictly scoped to the vehicle's company admin
    io.to(`company:${vehicle.companyId}`).emit("vehicle:location", locationUpdate);
  }

  return {
    success: true,
    vehicleId: vehicle.id,
    vehicleName: vehicle.name,
    regNo: vehicle.regNo,
    companyId: vehicle.companyId,
    pointId: point.id,
  };
}
