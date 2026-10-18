import http from "http";
import https from "https";
import crypto from "crypto";
import { prisma } from "../config/db";
import { processGpsPing, invalidateVehicleDeviceCache } from "./gps-ingest.service";

const GPS51_BASE_URL = "https://api.gps51.com/webapi";

let authToken: string | null = null;
let serverId = 0;
let tokenExpiresAt = 0;
let pollerTimer: NodeJS.Timeout | null = null;
let isPolling = false;

/** In-memory map of GPS51 deviceId -> TrackFleet vehicleId (avoids DB upsert every poll). */
const ensuredDeviceMap = new Map<string, string>();

function postJson(url: string, data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const bodyStr = JSON.stringify(data);
    const client = u.protocol === "https:" ? https : http;

    const req = client.request(
      u,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(bodyStr),
          "User-Agent": "TrackFleet-Server/1.0",
        },
        timeout: 15000,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error(`Failed to parse response: ${raw.slice(0, 100)}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.write(bodyStr);
    req.end();
  });
}

/** Parse GPS51 timestamps (ms, seconds, or "yyyy-MM-dd HH:mm:ss"). */
export function parseGps51Time(value: unknown): Date {
  if (value == null || value === "" || value === 0 || value === "0") return new Date();

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return new Date();
    return new Date(value < 1e12 ? value * 1000 : value);
  }

  const raw = String(value).trim();
  if (!raw) return new Date();

  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return new Date(n < 1e12 ? n * 1000 : n);
  }

  // GPS51 often returns "2026-03-09 23:14:18" (Europe/Copenhagen local)
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const asLocalDk = new Date(`${normalized}+02:00`);
  if (!Number.isNaN(asLocalDk.getTime())) return asLocalDk;

  const asIso = new Date(normalized);
  if (!Number.isNaN(asIso.getTime())) return asIso;

  return new Date();
}

function extractRegNo(fullName: string, fallback: string): string {
  if (fullName.includes("-")) return fullName.split("-")[1].trim() || fallback;
  if (fullName.includes("/")) return fullName.split("/")[1].trim() || fallback;
  return fallback;
}

async function ensureDefaultCompany() {
  const configuredId = process.env.GPS51_COMPANY_ID?.trim();
  if (configuredId) {
    const configured = await prisma.company.findUnique({ where: { id: configuredId } });
    if (configured) return configured;
  }

  // Prefer a company that already has a COMPANY_ADMIN so live map stays tenant-scoped
  const withAdmin = await prisma.company.findFirst({
    where: { users: { some: { role: "COMPANY_ADMIN" } } },
    orderBy: { createdAt: "asc" },
  });
  if (withAdmin) return withAdmin;

  let company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });
  if (!company) {
    company = await prisma.company.create({
      data: {
        id: "seed-company-default",
        name: "Sjællands Autoteknik",
        status: "ACTIVE",
      },
    });
  }
  return company;
}

/**
 * Upsert a GPS51 device into TrackFleet so live pings are never dropped
 * as "unregistered".
 */
async function ensureVehicleFromGps51(dev: {
  deviceid: string | number;
  devicename?: string;
  rename?: boolean;
}): Promise<string> {
  const devId = String(dev.deviceid).trim();
  const cached = ensuredDeviceMap.get(devId);
  if (cached && !dev.rename) return cached;

  const fullName = (dev.devicename || `Vehicle ${devId}`).trim();
  let regNo = extractRegNo(fullName, devId);
  const company = await ensureDefaultCompany();

  // Prefer existing vehicle matched by deviceId (any case)
  const existing = await prisma.vehicle.findFirst({
    where: { deviceId: { equals: devId, mode: "insensitive" } },
    select: { id: true, deviceId: true },
  });
  if (existing) {
    if (dev.rename) {
      await prisma.vehicle.update({
        where: { id: existing.id },
        data: { name: fullName },
      });
    }
    ensuredDeviceMap.set(devId, existing.id);
    invalidateVehicleDeviceCache(devId);
    invalidateVehicleDeviceCache(existing.deviceId);
    return existing.id;
  }

  // Avoid unique regNo collisions across devices
  const regTaken = await prisma.vehicle.findUnique({
    where: { regNo },
    select: { id: true },
  });
  if (regTaken) {
    regNo = `GPS-${devId}`;
  }

  const vehicle = await prisma.vehicle.create({
    data: {
      deviceId: devId,
      name: fullName,
      regNo,
      type: "Car",
      status: "OFFLINE",
      companyId: company.id,
    },
    select: { id: true },
  });

  ensuredDeviceMap.set(devId, vehicle.id);
  invalidateVehicleDeviceCache(devId);
  return vehicle.id;
}

async function login(): Promise<string> {
  if (authToken && Date.now() < tokenExpiresAt) {
    return authToken;
  }

  const username = process.env.GPS51_USERNAME || "Nabil Boallal";
  const password = process.env.GPS51_PASSWORD || "Aa1357";
  const pwdMd5 = crypto.createHash("md5").update(password).digest("hex");

  const res = await postJson(`${GPS51_BASE_URL}?action=login`, {
    type: "USER",
    from: "web",
    username,
    password: pwdMd5,
    browser: "TrackFleet-Server/1.0",
  });

  if (res.status !== 0 || !res.token) {
    throw new Error(`GPS51 Login failed: status=${res.status}, cause=${res.cause}`);
  }

  authToken = res.token;
  serverId = res.serverid ?? 0;
  tokenExpiresAt = Date.now() + 12 * 60 * 60 * 1000;
  console.log(
    `[GPS51 Cloud] Authenticated as "${username}" (Token: ${authToken!.slice(0, 8)}..., ServerID: ${serverId})`
  );
  return authToken!;
}

export async function syncVehiclesFromGps51(): Promise<void> {
  try {
    const token = await login();
    const username = process.env.GPS51_USERNAME || "Nabil Boallal";

    const monitorRes = await postJson(
      `${GPS51_BASE_URL}?action=querymonitorlist&token=${token}&serverid=${serverId}`,
      { username }
    );

    if (monitorRes.status !== 0) {
      if (monitorRes.status === 9903 || monitorRes.status === 9906) {
        authToken = null;
      }
      console.warn(
        `[GPS51 Cloud] querymonitorlist failed: status=${monitorRes.status}, cause=${monitorRes.cause}`
      );
      return;
    }

    let count = 0;
    for (const group of monitorRes.groups || []) {
      for (const dev of group.devices || []) {
        await ensureVehicleFromGps51({ ...dev, rename: true });
        count++;
      }
    }

    invalidateVehicleDeviceCache();
    console.log(`[GPS51 Cloud] Synced ${count} vehicles to TrackFleet database`);
  } catch (err: any) {
    console.warn(`[GPS51 Cloud] Sync vehicles error:`, err.message);
  }
}

/** In-memory cache of deviceId -> today's calculated distance (km) */
const deviceTodayKmMap = new Map<string, number>();
let lastTodaySyncDate = "";

/**
 * Syncs today's distance for all devices from GPS51 cloud history tracks.
 */
export async function syncTodayDistancesFromGps51(): Promise<void> {
  try {
    const token = await login();
    const todayStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Copenhagen",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    if (lastTodaySyncDate !== todayStr) {
      deviceTodayKmMap.clear();
      lastTodaySyncDate = todayStr;
    }

    const username = process.env.GPS51_USERNAME || "Nabil Boallal";
    const monitorRes = await postJson(
      `${GPS51_BASE_URL}?action=querymonitorlist&token=${token}&serverid=${serverId}`,
      { username }
    );
    if (monitorRes.status !== 0) return;

    for (const group of monitorRes.groups || []) {
      for (const dev of group.devices || []) {
        const devId = String(dev.deviceid).trim();
        if (!devId) continue;
        try {
          const trackRes = await postJson(
            `${GPS51_BASE_URL}?action=querytracks&token=${token}&serverid=${serverId}`,
            {
              deviceid: devId,
              begintime: `${todayStr} 00:00:00`,
              endtime: `${todayStr} 23:59:59`,
              timezone: 2,
            }
          );
          const records = trackRes?.records || [];
          let todayKm = 0;
          if (records.length > 1) {
            const firstDist = records[0].totaldistance;
            const lastDist = records[records.length - 1].totaldistance;
            if (firstDist && lastDist && lastDist >= firstDist) {
              todayKm = (lastDist - firstDist) / 1000;
            }
            if (todayKm === 0) {
              let haversineSum = 0;
              const R = 6371;
              for (let i = 1; i < records.length; i++) {
                const p1 = records[i - 1];
                const p2 = records[i];
                const dLat = ((p2.callat - p1.callat) * Math.PI) / 180;
                const dLon = ((p2.callon - p1.callon) * Math.PI) / 180;
                const a =
                  Math.sin(dLat / 2) ** 2 +
                  Math.cos((p1.callat * Math.PI) / 180) *
                    Math.cos((p2.callat * Math.PI) / 180) *
                    Math.sin(dLon / 2) ** 2;
                haversineSum += 2 * R * Math.asin(Math.sqrt(a));
              }
              todayKm = haversineSum;
            }
          }
          const roundedTodayKm = Math.round(todayKm * 100) / 100;
          deviceTodayKmMap.set(devId, roundedTodayKm);

          await prisma.vehicle.updateMany({
            where: { deviceId: devId },
            data: { todayKm: roundedTodayKm },
          });
        } catch {
          // Ignore individual track failure
        }
      }
    }
    console.log(`[GPS51 Cloud] Synced today distance for ${deviceTodayKmMap.size} devices`);
  } catch (err: any) {
    console.warn(`[GPS51 Cloud] Could not sync today distances:`, err.message);
  }
}

export async function pollGps51LivePositions(): Promise<void> {
  if (isPolling) return;
  isPolling = true;

  try {
    const token = await login();
    const username = process.env.GPS51_USERNAME || "Nabil Boallal";

    const posRes = await postJson(
      `${GPS51_BASE_URL}?action=lastposition&token=${token}&serverid=${serverId}`,
      {
        username,
        deviceids: [],
        lastquerypositiontime: 0,
      }
    );

    if (posRes.status !== 0) {
      if (posRes.status === 9903 || posRes.status === 9906) {
        authToken = null;
      }
      console.warn(
        `[GPS51 Cloud] lastposition failed: status=${posRes.status}, cause=${posRes.cause}`
      );
      return;
    }

    const records = Array.isArray(posRes.records) ? posRes.records : [];
    let saved = 0;
    let live = 0;

    for (const r of records) {
      const devId = String(r.deviceid ?? "").trim();
      if (!devId) continue;

      // Always upsert so pings are never dropped as "unregistered"
      await ensureVehicleFromGps51({
        deviceid: devId,
        devicename: r.devicename || r.deviceName,
      });

      const lat = Number(r.callat);
      const lng = Number(r.callon);
      const speed = Number(r.speed || 0);
      const heading = Number(r.course || 0);

      const strStatus = String(r.strstatusen || r.strstatus || "").toLowerCase();
      const rawStatus = Number(r.status || 0);
      const isOffline =
        strStatus.includes("offline") ||
        strStatus.includes("expired") ||
        strStatus.includes("out of service") ||
        r.online === 0 ||
        r.online === false ||
        r.online === "0";
      const isAccOn =
        !isOffline &&
        ((rawStatus & 1) === 1 ||
          strStatus.includes("acc on") ||
          strStatus.includes("running"));
      const isMoving = !isOffline && (speed > 2 || Number(r.moving) === 1);

      let motionStatus: "PARKED" | "IDLE" | "RUNNING" | "OFFLINE" = "PARKED";
      if (isOffline) {
        motionStatus = "OFFLINE";
      } else if (isMoving) {
        motionStatus = "RUNNING";
      } else if (isAccOn) {
        motionStatus = "IDLE";
      } else {
        motionStatus = "PARKED";
      }

      if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
        // Fallback safely if devicetime is 0 so it never reverts to 1970
        const rawTime =
          r.devicetime && r.devicetime !== 0 && r.devicetime !== "0"
            ? r.devicetime
            : r.updatetime || r.arrivedtime || r.validpoistiontime;
        const recordedAt = parseGps51Time(rawTime);

        // Real odometer from GPS51 (totaldistance or mileage in meters)
        const rawDistanceMeters = Number(r.totaldistance ?? r.mileage ?? 0);
        const totalKm =
          rawDistanceMeters > 0 ? Math.round(rawDistanceMeters / 1000) : undefined;

        // Telemetry: Voltage (exvoltage in 100ths of Volt e.g. 1300 = 13.0V), Signal %, Satellites
        const rawExVoltage = Number(r.exvoltage ?? 0);
        const voltage =
          rawExVoltage > 0 ? Math.round((rawExVoltage / 100) * 10) / 10 : undefined;
        const signalPercent =
          Number(r.rxlevel ?? 0) > 0 ? Math.min(100, Math.max(0, Number(r.rxlevel))) : undefined;
        const satellites =
          Number(r.gpsvalidnum ?? -1) >= 0 ? Number(r.gpsvalidnum) : undefined;

        const todayKm = deviceTodayKmMap.get(devId);

        const result = await processGpsPing({
          deviceId: devId,
          latitude: lat,
          longitude: lng,
          speed,
          heading,
          motionStatus,
          engineOn: isAccOn || isMoving,
          isValid: true,
          markOnline: !isOffline,
          recordedAt,
          currentKm: totalKm,
          todayKm,
          voltage,
          signalPercent,
          satellites,
        });
        live++;
        if (result.pointId) saved++;
      }
    }

    if (records.length > 0) {
      console.log(
        `[GPS51 Cloud] Live poll: ${records.length} devices, ${live} with coords, ${saved} GpsPoints stored`
      );
    }
  } catch (err: any) {
    console.warn(`[GPS51 Cloud] Polling error:`, err.message);
  } finally {
    isPolling = false;
  }
}

export function startGps51SyncService(intervalSeconds = 15): void {
  const isEnabled = process.env.GPS51_ENABLED !== "false";
  if (!isEnabled) {
    console.log("[GPS51 Cloud] GPS51 Cloud sync is disabled by config");
    return;
  }

  console.log(
    `[GPS51 Cloud] Starting live cloud sync service (polling every ${intervalSeconds}s)...`
  );

  syncVehiclesFromGps51()
    .then(() => syncTodayDistancesFromGps51())
    .then(() => pollGps51LivePositions());

  if (pollerTimer) clearInterval(pollerTimer);
  pollerTimer = setInterval(() => {
    pollGps51LivePositions();
  }, intervalSeconds * 1000);

  setInterval(() => {
    syncVehiclesFromGps51().then(() => syncTodayDistancesFromGps51());
  }, 10 * 60 * 1000);
}

export async function fetchGps51HistoricalTracks(
  deviceId: string,
  dateStr: string
): Promise<any[]> {
  try {
    const token = await login();
    const trackPayload = {
      deviceid: deviceId,
      begintime: `${dateStr} 00:00:00`,
      endtime: `${dateStr} 23:59:59`,
      timezone: 2,
    };

    const resp = await postJson(
      `${GPS51_BASE_URL}?action=querytracks&token=${token}&serverid=${serverId}`,
      trackPayload
    );

    if (resp && resp.status === 0 && Array.isArray(resp.records)) {
      return resp.records;
    }
    if (resp?.status === 9903 || resp?.status === 9906) {
      authToken = null;
    }
    return [];
  } catch (err: any) {
    console.warn(`[GPS51 Cloud] Could not fetch tracks for ${deviceId}:`, err.message);
    return [];
  }
}
