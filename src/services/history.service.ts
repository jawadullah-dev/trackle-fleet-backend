import { Role } from "@prisma/client";
import { prisma } from "../config/db";
import { AppError } from "../utils/app-error";
import { JwtPayload } from "../utils/auth";
import { resolveCompanyForActor } from "./company.service";
import { getIO } from "./socket.service";

function ensureCompanyAdmin(user: JwtPayload) {
  if (user.role === Role.SUPER_ADMIN) {
    throw new AppError(
      "Access denied: Super Admin cannot access vehicle trip history",
      403
    );
  }
}

function dayBounds(dateStr: string) {
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new AppError("Invalid date. Use YYYY-MM-DD", 400);
  }
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function monthBounds(monthStr: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthStr);
  if (!match) throw new AppError("Invalid month. Use YYYY-MM", 400);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new AppError("Invalid month. Use YYYY-MM", 400);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}

/** Approximate distance in km between two lat/lng points (Haversine formula). */
export function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function getAccessibleVehicle(vehicleId: string, actor: JwtPayload) {
  ensureCompanyAdmin(actor);
  const companyId = await resolveCompanyForActor(actor);

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: {
      id: true,
      name: true,
      regNo: true,
      type: true,
      deviceId: true,
      status: true,
      companyId: true,
    },
  });
  if (!vehicle) throw new AppError("Vehicle not found", 404);

  if (vehicle.companyId !== companyId) {
    throw new AppError("Access denied for this vehicle", 403);
  }

  return vehicle;
}

export async function getDayHistory(
  actor: JwtPayload,
  vehicleId: string,
  date: string
) {
  if (!vehicleId) throw new AppError("vehicleId is required", 400);
  if (!date) throw new AppError("date is required (YYYY-MM-DD)", 400);

  const vehicle = await getAccessibleVehicle(vehicleId, actor);
  const { start, end } = dayBounds(date);

  let points = await prisma.gpsPoint.findMany({
    where: {
      vehicleId,
      recordedAt: { gte: start, lt: end },
    },
    orderBy: { recordedAt: "asc" },
    select: {
      id: true,
      latitude: true,
      longitude: true,
      speed: true,
      recordedAt: true,
    },
  });

  // If few or no points recorded locally for this date, fetch historical trip from GPS51 cloud on demand
  if (points.length < 5 && vehicle.deviceId) {
    try {
      const { fetchGps51HistoricalTracks } = require("./gps51-sync.service");
      const records = await fetchGps51HistoricalTracks(vehicle.deviceId, date);
      if (Array.isArray(records) && records.length > 0) {
        const createData = records
          .filter(
            (r: any) =>
              r.callat &&
              r.callon &&
              !isNaN(Number(r.callat)) &&
              !isNaN(Number(r.callon))
          )
          .map((r: any) => ({
            vehicleId,
            latitude: Number(r.callat),
            longitude: Number(r.callon),
            speed: Number(r.speed || 0),
            recordedAt: new Date(Number(r.updatetime || r.starttime || Date.now())),
          }));

        if (createData.length > 0) {
          await prisma.gpsPoint.createMany({
            data: createData,
            skipDuplicates: true,
          });

          points = await prisma.gpsPoint.findMany({
            where: {
              vehicleId,
              recordedAt: { gte: start, lt: end },
            },
            orderBy: { recordedAt: "asc" },
            select: {
              id: true,
              latitude: true,
              longitude: true,
              speed: true,
              recordedAt: true,
            },
          });
        }
      }
    } catch (err: any) {
      console.warn(`[History] Could not fetch GPS51 cloud tracks for ${vehicle.deviceId}:`, err.message);
    }
  }

  let distanceKm = 0;
  for (let i = 1; i < points.length; i++) {
    distanceKm += haversineKm(points[i - 1], points[i]);
  }

  const roundedDistance = Math.round(distanceKm * 100) / 100;

  return {
    vehicle,
    date,
    points,
    totalDistanceKm: roundedDistance,
    distanceKm: roundedDistance,
    pointCount: points.length,
    summary: {
      pointCount: points.length,
      distanceKm: roundedDistance,
      startAt: points[0]?.recordedAt ?? null,
      endAt: points[points.length - 1]?.recordedAt ?? null,
    },
  };
}

export async function getHistoryDays(
  actor: JwtPayload,
  vehicleId: string,
  month: string
) {
  if (!vehicleId) throw new AppError("vehicleId is required", 400);
  if (!month) throw new AppError("month is required (YYYY-MM)", 400);

  const vehicle = await getAccessibleVehicle(vehicleId, actor);
  const { start, end } = monthBounds(month);

  const points = await prisma.gpsPoint.findMany({
    where: {
      vehicleId,
      recordedAt: { gte: start, lt: end },
    },
    select: {
      latitude: true,
      longitude: true,
      recordedAt: true,
    },
    orderBy: { recordedAt: "asc" },
  });

  const distancesByDay = new Map<
    string,
    { distanceKm: number; lastPoint: (typeof points)[number] }
  >();

  for (const p of points) {
    const day = p.recordedAt.toISOString().slice(0, 10);
    const previous = distancesByDay.get(day);
    distancesByDay.set(day, {
      distanceKm:
        (previous?.distanceKm ?? 0) +
        (previous ? haversineKm(previous.lastPoint, p) : 0),
      lastPoint: p,
    });
  }

  // Always mark today's date in days list if within the requested month
  const todayYmd = new Date().toISOString().slice(0, 10);
  if (todayYmd.startsWith(month) && !distancesByDay.has(todayYmd)) {
    distancesByDay.set(todayYmd, { distanceKm: 0.1, lastPoint: { latitude: 0, longitude: 0, recordedAt: new Date() } });
  }

  return {
    vehicleId,
    month,
    days: Array.from(distancesByDay.keys()).sort(),
    distancesKm: Object.fromEntries(
      Array.from(distancesByDay, ([day, data]) => [
        day,
        Math.round(data.distanceKm * 100) / 100,
      ]),
    ),
  };
}

export async function ingestGpsPoints(
  actor: JwtPayload,
  body: {
    vehicleId: string;
    points: {
      latitude: number;
      longitude: number;
      speed?: number | null;
      recordedAt: string | Date;
    }[];
  }
) {
  const vehicle = await getAccessibleVehicle(body.vehicleId, actor);

  if (!body.points?.length) {
    throw new AppError("At least one GPS point is required", 400);
  }

  const data = body.points.map((p) => ({
    vehicleId: vehicle.id,
    latitude: p.latitude,
    longitude: p.longitude,
    speed: p.speed ?? null,
    recordedAt: new Date(p.recordedAt),
  }));

  for (const row of data) {
    if (Number.isNaN(row.recordedAt.getTime())) {
      throw new AppError("Invalid recordedAt on a GPS point", 400);
    }
  }

  const result = await prisma.gpsPoint.createMany({ data });

  // Update vehicle live position to last point
  const last = data[data.length - 1];
  const updatedVehicle = await prisma.vehicle.update({
    where: { id: vehicle.id },
    data: {
      latitude: last.latitude,
      longitude: last.longitude,
      lastUpdate: last.recordedAt,
      status: "ONLINE",
    },
    select: {
      id: true,
      name: true,
      regNo: true,
      type: true,
      companyId: true,
      latitude: true,
      longitude: true,
      status: true,
      lastUpdate: true,
    },
  });

  const io = getIO();
  if (io && updatedVehicle.latitude != null && updatedVehicle.longitude != null) {
    const locationUpdate = {
      id: updatedVehicle.id,
      vehicleId: updatedVehicle.id,
      name: updatedVehicle.name,
      regNo: updatedVehicle.regNo,
      type: updatedVehicle.type,
      status: updatedVehicle.status,
      lat: updatedVehicle.latitude,
      latitude: updatedVehicle.latitude,
      lng: updatedVehicle.longitude,
      longitude: updatedVehicle.longitude,
      speed: last.speed ?? 0,
      heading: 0,
      timestamp: updatedVehicle.lastUpdate.toISOString(),
      lastUpdate: updatedVehicle.lastUpdate.toISOString(),
      companyId: updatedVehicle.companyId,
    };
    // Emit STRICTLY to company room
    io.to(`company:${updatedVehicle.companyId}`).emit("vehicle:location", locationUpdate);
  }

  return { inserted: result.count, vehicleId: vehicle.id };
}
