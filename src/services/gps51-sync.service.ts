import http from "http";
import https from "https";
import crypto from "crypto";
import { prisma } from "../config/db";
import { env } from "../config/env";
import { processGpsPing } from "./gps-ingest.service";

const GPS51_BASE_URL = "https://api.gps51.com/webapi";

let authToken: string | null = null;
let serverId = 0;
let tokenExpiresAt = 0;
let pollerTimer: NodeJS.Timeout | null = null;
let isPolling = false;

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
        timeout: 10000,
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
  console.log(`[GPS51 Cloud] Authenticated successfully as "${username}" (Token: ${authToken!.slice(0, 8)}..., ServerID: ${serverId})`);
  return authToken!;
}

export async function syncVehiclesFromGps51(): Promise<void> {
  try {
    const token = await login();
    const username = process.env.GPS51_USERNAME || "Nabil Boallal";

    let company = await prisma.company.findFirst();
    if (!company) {
      company = await prisma.company.create({
        data: {
          id: "seed-company-default",
          name: "Sjællands Autoteknik",
          status: "ACTIVE",
        },
      });
    }

    const monitorRes = await postJson(
      `${GPS51_BASE_URL}?action=querymonitorlist&token=${token}&serverid=${serverId}`,
      { username }
    );

    if (monitorRes.status !== 0) {
      if (monitorRes.status === 9903 || monitorRes.status === 9906) {
        authToken = null;
      }
      return;
    }

    const devices: any[] = [];
    for (const group of monitorRes.groups || []) {
      for (const dev of group.devices || []) {
        devices.push(dev);
      }
    }

    for (const dev of devices) {
      const devId = String(dev.deviceid);
      const fullName = dev.devicename || `Vehicle ${devId}`;
      let regNo = devId;
      if (fullName.includes("-")) {
        regNo = fullName.split("-")[1].trim();
      } else if (fullName.includes("/")) {
        regNo = fullName.split("/")[1].trim();
      }

      await prisma.vehicle.upsert({
        where: { deviceId: devId },
        update: {
          name: fullName,
        },
        create: {
          deviceId: devId,
          name: fullName,
          regNo,
          type: "Car",
          status: "ONLINE",
          companyId: company.id,
        },
      });
    }
    console.log(`[GPS51 Cloud] Synced ${devices.length} vehicles to TrackFleet database`);
  } catch (err: any) {
    console.warn(`[GPS51 Cloud] Sync vehicles error:`, err.message);
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
      return;
    }

    const records = Array.isArray(posRes.records) ? posRes.records : [];
    for (const r of records) {
      const devId = String(r.deviceid);
      const lat = Number(r.callat);
      const lng = Number(r.callon);
      const speed = Number(r.speed || 0);
      const heading = Number(r.course || 0);

      // Determine Engine & Motion State:
      // Green = Engine On & Moving (RUNNING)
      // Blue = Engine On & Stationary (IDLE)
      // Red = Engine Off / Parked (PARKED)
      // Grey = Lost connection (OFFLINE)
      const strStatus = String(r.strstatusen || "").toLowerCase();
      const rawStatus = Number(r.status || 0);
      const isAccOn = (rawStatus & 1) === 1 || strStatus.includes("acc on") || strStatus.includes("running");
      const isMoving = speed > 2 || Number(r.moving) === 1;

      let motionStatus: "PARKED" | "IDLE" | "RUNNING" | "OFFLINE" = "PARKED";
      if (isMoving) {
        motionStatus = "RUNNING"; // Green: Moving with engine on
      } else if (isAccOn) {
        motionStatus = "IDLE"; // Blue: Engine on, but idle / stationary
      } else {
        motionStatus = "PARKED"; // Red: Engine is off, parked
      }

      if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
        await processGpsPing({
          deviceId: devId,
          latitude: lat,
          longitude: lng,
          speed,
          heading,
          motionStatus,
          engineOn: isAccOn || isMoving,
          isValid: true,
          recordedAt: new Date(r.devicetime || Date.now()),
        });
      }
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

  console.log(`[GPS51 Cloud] Starting live cloud sync service (polling every ${intervalSeconds}s)...`);

  // Initial sync & poll
  syncVehiclesFromGps51().then(() => pollGps51LivePositions());

  // Recurring position polling
  if (pollerTimer) clearInterval(pollerTimer);
  pollerTimer = setInterval(() => {
    pollGps51LivePositions();
  }, intervalSeconds * 1000);

  // Periodic device catalog sync every 30 minutes
  setInterval(() => {
    syncVehiclesFromGps51();
  }, 30 * 60 * 1000);
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
    return [];
  } catch (err: any) {
    console.warn(`[GPS51 Cloud] Could not fetch tracks for ${deviceId}:`, err.message);
    return [];
  }
}

