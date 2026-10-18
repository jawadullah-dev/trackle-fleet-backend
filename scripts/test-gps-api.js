#!/usr/bin/env node

/**
 * Quick Test Script for GPS51 & TrackFleet APIs
 * Run: node scripts/test-gps-api.js
 */

const https = require("https");
const http = require("http");
const crypto = require("crypto");

const GPS51_URL = "https://api.gps51.com/webapi";
const USERNAME = "Nabil Boallal";
const PASSWORD_PLAIN = "Aa1357";
const PWD_MD5 = crypto.createHash("md5").update(PASSWORD_PLAIN).digest("hex");

function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const bodyStr = JSON.stringify(body);
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
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(raw);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

async function run() {
  console.log("==================================================================");
  console.log("🔍 GPS51 CLOUD API DIRECT TEST");
  console.log("==================================================================");
  console.log(`Endpoint: ${GPS51_URL}`);
  console.log(`Username: ${USERNAME}`);
  console.log(`MD5 Hash: ${PWD_MD5}\n`);

  // Step 1: Login
  console.log("1️⃣ [POST] Logging into GPS51 cloud (action=login)...");
  const loginRes = await post(`${GPS51_URL}?action=login`, {
    type: "USER",
    from: "web",
    username: USERNAME,
    password: PWD_MD5,
    browser: "TrackFleet-Server/1.0",
  });

  console.log("Response:", {
    status: loginRes.status,
    cause: loginRes.cause,
    token: loginRes.token ? `${loginRes.token.slice(0, 10)}...` : null,
    serverid: loginRes.serverid,
  });

  if (loginRes.status !== 0 || !loginRes.token) {
    console.error("❌ Login failed!");
    return;
  }

  const token = loginRes.token;
  const serverId = loginRes.serverid ?? 0;

  // Step 2: Query Live Telemetry (lastposition)
  console.log("\n2️⃣ [POST] Fetching Real-Time Vehicle Positions (action=lastposition)...");
  const posRes = await post(
    `${GPS51_URL}?action=lastposition&token=${token}&serverid=${serverId}`,
    {
      username: USERNAME,
      deviceids: [],
      lastquerypositiontime: 0,
    }
  );

  console.log(`Total Live Vehicle Records: ${posRes.records ? posRes.records.length : 0}\n`);

  for (const r of (posRes.records || []).slice(0, 3)) {
    const km = r.totaldistance ? (Number(r.totaldistance) / 1000).toLocaleString() : "0";
    console.log(`📌 Device [${r.deviceid}] (${r.devicename || "Vehicle"}):`);
    console.log(`   - Coordinates   : Lat ${r.callat}, Lng ${r.callon}`);
    console.log(`   - Speed         : ${r.speed} km/h`);
    console.log(`   - Total Mileage : ${km} km (${r.totaldistance} meters)`);
    console.log(`   - Status String : ${r.strstatusen}`);
    console.log(`   - Voltage       : ${r.exvoltage ? (r.exvoltage / 100).toFixed(1) + "V" : "—"}`);
    console.log(`   - Satellites    : ${r.gpsvalidnum} sats | Signal: ${r.rxlevel}%`);
    console.log(`   - Raw Devicetime: ${r.devicetime} | Updatetime: ${r.updatetime}\n`);
  }

  console.log("==================================================================");
  console.log("✅ GPS51 API query completed successfully!");
  console.log("==================================================================");
}

run().catch(console.error);
