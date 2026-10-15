#!/usr/bin/env node

/**
 * TrackFleet Live Highway Driving Simulator
 * Emulates a real vehicle driving live along Srinagar Highway, Islamabad.
 * Streams live coordinates, speed, and heading via REST & WebSocket directly to the dashboard.
 *
 * Usage:
 *   node scripts/live-drive.js [--deviceId 868010341870381] [--interval 2000] [--count 60]
 */

const http = require("http");

const args = process.argv.slice(2);
function getArg(flag, defaultValue) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : defaultValue;
}

const deviceId = getArg("--deviceId", "868010341870381");
const intervalMs = parseInt(getArg("--interval", "2000"), 10);
const maxCount = parseInt(getArg("--count", "100"), 10);
const port = parseInt(getArg("--port", "5000"), 10);

console.log("==================================================");
console.log(" 🚗 TRACKFLEET LIVE DRIVING SIMULATOR");
console.log("==================================================");
console.log(` Target Vehicle Device ID : ${deviceId}`);
console.log(` Interval                 : ${intervalMs} ms`);
console.log(` Total Waypoints          : ${maxCount}`);
console.log(` Route                    : Srinagar Highway, Islamabad`);
console.log("==================================================\n");

// Waypoints along Srinagar Highway (Islamabad)
const WAYPOINTS = [
  { lat: 33.6844, lng: 73.0479, heading: 45, speed: 52 },
  { lat: 33.6852, lng: 73.0491, heading: 46, speed: 58 },
  { lat: 33.6860, lng: 73.0504, heading: 48, speed: 64 },
  { lat: 33.6871, lng: 73.0520, heading: 50, speed: 62 },
  { lat: 33.6883, lng: 73.0538, heading: 52, speed: 60 },
  { lat: 33.6896, lng: 73.0557, heading: 55, speed: 65 },
  { lat: 33.6910, lng: 73.0578, heading: 54, speed: 68 },
  { lat: 33.6923, lng: 73.0601, heading: 55, speed: 70 },
  { lat: 33.6936, lng: 73.0624, heading: 56, speed: 65 },
  { lat: 33.6948, lng: 73.0648, heading: 58, speed: 60 },
  { lat: 33.6958, lng: 73.0671, heading: 60, speed: 55 },
  { lat: 33.6965, lng: 73.0694, heading: 62, speed: 50 },
  // Return loop
  { lat: 33.6963, lng: 73.0690, heading: 242, speed: 50 },
  { lat: 33.6954, lng: 73.0665, heading: 238, speed: 58 },
  { lat: 33.6942, lng: 73.0638, heading: 236, speed: 64 },
  { lat: 33.6929, lng: 73.0612, heading: 235, speed: 66 },
  { lat: 33.6916, lng: 73.0588, heading: 234, speed: 65 },
  { lat: 33.6902, lng: 73.0565, heading: 232, speed: 62 },
  { lat: 33.6889, lng: 73.0545, heading: 230, speed: 58 },
  { lat: 33.6876, lng: 73.0526, heading: 228, speed: 55 },
  { lat: 33.6864, lng: 73.0509, heading: 226, speed: 52 },
  { lat: 33.6852, lng: 73.0491, heading: 225, speed: 48 },
];

let step = 0;

function sendPing() {
  if (step >= maxCount) {
    console.log("\n✅ Live driving simulation finished.");
    process.exit(0);
  }

  const wp = WAYPOINTS[step % WAYPOINTS.length];
  // Add subtle jitter to simulate GPS micro-drift
  const jitterLat = (Math.random() - 0.5) * 0.00008;
  const jitterLng = (Math.random() - 0.5) * 0.00008;
  const currentLat = Number((wp.lat + jitterLat).toFixed(6));
  const currentLng = Number((wp.lng + jitterLng).toFixed(6));
  const currentSpeed = Math.round(wp.speed + (Math.random() - 0.5) * 4);

  const payload = JSON.stringify({
    deviceId,
    lat: currentLat,
    lng: currentLng,
    speed: currentSpeed,
    heading: wp.heading,
  });

  const req = http.request(
    {
      hostname: "localhost",
      port,
      path: "/api/gps/track",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    },
    (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode === 200) {
          console.log(
            `[${step + 1}/${maxCount}] 📍 Live Ping Sent: Lat=${currentLat}, Lng=${currentLng}, Speed=${currentSpeed} km/h, Heading=${wp.heading}°`
          );
        } else {
          console.warn(`[${step + 1}] ⚠️ Status ${res.statusCode}: ${data}`);
        }
        step++;
        setTimeout(sendPing, intervalMs);
      });
    }
  );

  req.on("error", (err) => {
    console.error(`[Error] Could not connect to API on port ${port}:`, err.message);
    setTimeout(sendPing, intervalMs);
  });

  req.write(payload);
  req.end();
}

// Start streaming live points
sendPing();
