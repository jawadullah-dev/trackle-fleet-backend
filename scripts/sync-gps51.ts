import http from "http";
import https from "https";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const GPS51_USERNAME = "Nabil Boallal";
const GPS51_PASSWORD = "Aa1357";
const GPS51_BASE_URL = "https://api.gps51.com/webapi";

let authToken: string | null = null;
let serverId = 0;
let tokenExpiresAt = 0;

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
          "User-Agent": "TrackFleet/1.0",
        },
        timeout: 10000,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error(`Failed to parse response: ${raw.slice(0, 200)}`));
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

  const pwdMd5 = crypto.createHash("md5").update(GPS51_PASSWORD).digest("hex");
  const res = await postJson(`${GPS51_BASE_URL}?action=login`, {
    type: "USER",
    from: "web",
    username: GPS51_USERNAME,
    password: pwdMd5,
    browser: "TrackFleet-Server/1.0",
  });

  if (res.status !== 0 || !res.token) {
    throw new Error(`GPS51 Login failed: status=${res.status}, cause=${res.cause}`);
  }

  authToken = res.token;
  serverId = res.serverid ?? 0;
  tokenExpiresAt = Date.now() + 12 * 60 * 60 * 1000;
  console.log(`[GPS51] Authenticated successfully! Token: ${authToken}, ServerID: ${serverId}`);
  return authToken!;
}

export async function syncAndSeedGps51Fleet() {
  const token = await login();
  if (!token) throw new Error("Could not authenticate with GPS51");

  // 1. Get Company
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

  // 2. Fetch all devices
  const monitorRes = await postJson(
    `${GPS51_BASE_URL}?action=querymonitorlist&token=${token}&serverid=${serverId}`,
    { username: GPS51_USERNAME }
  );

  if (monitorRes.status !== 0) {
    throw new Error(`Failed to query devices: ${monitorRes.cause}`);
  }

  const devices: any[] = [];
  for (const group of monitorRes.groups || []) {
    for (const dev of group.devices || []) {
      devices.push(dev);
    }
  }

  console.log(`[GPS51] Found ${devices.length} devices in GPS51 cloud`);

  // 3. Fetch current positions
  const posRes = await postJson(
    `${GPS51_BASE_URL}?action=lastposition&token=${token}&serverid=${serverId}`,
    {
      username: GPS51_USERNAME,
      deviceids: [],
      lastquerypositiontime: 0,
    }
  );

  const posMap = new Map<string, any>();
  if (posRes.status === 0 && Array.isArray(posRes.records)) {
    for (const r of posRes.records) {
      posMap.set(String(r.deviceid), r);
    }
  }

  // 4. Upsert into database
  for (const dev of devices) {
    const devId = String(dev.deviceid);
    const pos = posMap.get(devId);

    const lat = pos?.callat ? Number(pos.callat) : 55.6483;
    const lng = pos?.callon ? Number(pos.callon) : 12.289;
    const isOnline = pos?.strstatusen?.toLowerCase().includes("online") ?? true;

    // Derive vehicle name & plate
    const fullName = dev.devicename || `Vehicle ${devId}`;
    let regNo = devId;
    if (fullName.includes("-")) {
      regNo = fullName.split("-")[1].trim();
    } else if (fullName.includes("/")) {
      regNo = fullName.split("/")[1].trim();
    }

    const vehicle = await prisma.vehicle.upsert({
      where: { deviceId: devId },
      update: {
        name: fullName,
        latitude: lat,
        longitude: lng,
        status: "ONLINE",
        lastUpdate: new Date(),
      },
      create: {
        deviceId: devId,
        name: fullName,
        regNo: regNo,
        type: "Car",
        status: "ONLINE",
        latitude: lat,
        longitude: lng,
        companyId: company.id,
        lastUpdate: new Date(),
      },
    });

    console.log(`[GPS51] Synced vehicle "${vehicle.name}" (${vehicle.deviceId}) -> ${lat}, ${lng} [ONLINE]`);
  }

  console.log("[GPS51] Fleet sync completed successfully!");
}

if (require.main === module) {
  syncAndSeedGps51Fleet()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Sync error:", err);
      process.exit(1);
    });
}
