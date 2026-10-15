#!/usr/bin/env node

/**
 * TrackFleet GPS Hardware Tracker Simulator
 * Simulates physical 4G GPS trackers transmitting over raw TCP to the TrackFleet TCP server.
 *
 * Supported Protocols:
 *   - h02   : Text protocol (*HQ,ID,V1,time,A,lat,N,lon,E,speed,heading,date,status#)
 *             Default deviceId: 19210086602 (e.g. GPS Tracker 4G A7670SA)
 *   - gt06  : Binary protocol (0x78 0x78 login + ACK, location 0x12, heartbeat 0x13)
 *             Default deviceId: 868010341870381
 *   - coban : Coban text protocol (##,imei:...,A; -> LOAD -> location streaming)
 *
 * Usage:
 *   node scripts/simulate-device.js --protocol h02 --deviceId 19210086602 --count 15
 *   node scripts/simulate-device.js --protocol gt06 --deviceId 868010341870381 --count 10
 */

const net = require("net");

// Parse command line arguments
const args = process.argv.slice(2);
function getArg(flag, defaultValue) {
  const index = args.indexOf(flag);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return defaultValue;
}

const protocol = (getArg("--protocol", "jt808") || "jt808").toLowerCase();
const defaultDeviceId =
  protocol === "h02"
    ? "868101063247081"
    : protocol === "jt808"
    ? "868101063247081"
    : "868101063247081";
const deviceId = getArg("--deviceId", defaultDeviceId);
const port = parseInt(getArg("--port", process.env.GPS_TCP_PORT || "5023"), 10);
const host = getArg("--host", "127.0.0.1");
const count = parseInt(getArg("--count", "12"), 10);
const intervalMs = parseInt(getArg("--interval", "2000"), 10);

console.log("=================================================");
console.log(" 🛰️  TRACKFLEET HARDWARE GPS TRACKER SIMULATOR");
console.log("=================================================");
console.log(` Protocol  : ${protocol.toUpperCase()}`);
console.log(` Device ID : ${deviceId}`);
console.log(` Target    : ${host}:${port}`);
console.log(` Points    : ${count}`);
console.log(` Interval  : ${intervalMs} ms`);
console.log("=================================================\n");

// GT06 CRC Lookup Table
const GT06_CRC_TABLE = new Uint16Array([
  0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50a5, 0x60c6, 0x70e7,
  0x8108, 0x9129, 0xa14a, 0xb16b, 0xc18c, 0xd1ad, 0xe1ce, 0xf1ef,
  0x1231, 0x0210, 0x3273, 0x2252, 0x52b5, 0x4294, 0x72f7, 0x62d6,
  0x9339, 0x8318, 0xb37b, 0xa35a, 0xd3bd, 0xc39c, 0xf3ff, 0xe3de,
  0x2462, 0x3443, 0x0420, 0x1401, 0x64e6, 0x74c7, 0x44a4, 0x5485,
  0xa56a, 0xb54b, 0x8528, 0x9509, 0xe5ee, 0xf5cf, 0xc5ac, 0xd58d,
  0x3653, 0x2672, 0x1611, 0x0630, 0x76d7, 0x66f6, 0x5695, 0x46b4,
  0xb75b, 0xa77a, 0x9719, 0x8738, 0xf7df, 0xe7fe, 0xd79d, 0xc7bc,
  0x48c4, 0x58e5, 0x6886, 0x78a7, 0x0840, 0x1861, 0x2802, 0x3823,
  0xc9cc, 0xd9ed, 0xe98e, 0xf9af, 0x8948, 0x9969, 0xa90a, 0xb92b,
  0x5af5, 0x4ad4, 0x7ab7, 0x6a96, 0x1a71, 0x0a50, 0x3a33, 0x2a12,
  0xdbfd, 0xcbdc, 0xfbbf, 0xeb9e, 0x9b79, 0x8b58, 0xbb3b, 0xab1a,
  0x6ca6, 0x7c87, 0x4ce4, 0x5cc5, 0x2c22, 0x3c03, 0x0c60, 0x1c41,
  0xedae, 0xfd8f, 0xcdec, 0xddcd, 0xad2a, 0xbd0b, 0x8d68, 0x9d49,
  0x7e97, 0x6eb6, 0x5ed5, 0x4ef4, 0x3e13, 0x2e32, 0x1e51, 0x0e70,
  0xff9f, 0xefbe, 0xdfdd, 0xcffc, 0xbf1b, 0xaf3a, 0x9f59, 0x8f78,
  0x9188, 0x81a9, 0xb1ca, 0xa1eb, 0xd10c, 0xc12d, 0xf14e, 0xe16f,
  0x1080, 0x00a1, 0x30c2, 0x20e3, 0x5004, 0x4025, 0x7046, 0x6067,
  0x83b9, 0x9398, 0xa3fb, 0xb3da, 0xc33d, 0xd31c, 0xe37f, 0xf35e,
  0x02b1, 0x1290, 0x22f3, 0x32d2, 0x4235, 0x5214, 0x6277, 0x7256,
  0xb5ea, 0xa5cb, 0x95a8, 0x8589, 0xf56e, 0xe54f, 0xd52c, 0xc50d,
  0x34e2, 0x24c3, 0x14a0, 0x0481, 0x7466, 0x6447, 0x5424, 0x4405,
  0xa7db, 0xb7fa, 0x8799, 0x97b8, 0xe75f, 0xf77e, 0xc71d, 0xd73c,
  0x26d3, 0x36f2, 0x0691, 0x16b0, 0x6657, 0x7676, 0x4615, 0x5634,
  0xd94c, 0xc96d, 0xf90e, 0xe92f, 0x99c8, 0x89e9, 0xb98a, 0xa9ab,
  0x5844, 0x4865, 0x7806, 0x6827, 0x18c0, 0x08e1, 0x3882, 0x28a3,
  0xcb7d, 0xdb5c, 0xeb3f, 0xfb1e, 0x8bf9, 0x9bd8, 0xabbb, 0xbb9a,
  0x4a75, 0x5a54, 0x6a37, 0x7a16, 0x0af1, 0x1ad0, 0x2ab3, 0x3a92,
  0xfd2e, 0xed0f, 0xdd6c, 0xcd4d, 0xbdaa, 0xad8b, 0x9de8, 0x8dc9,
  0x7c26, 0x6c07, 0x5c64, 0x4c45, 0x3c22, 0x2c03, 0x1c61, 0x0c40,
  0xef9f, 0xffbe, 0xcfed, 0xdfcc, 0xaf1b, 0xbf3a, 0x8f59, 0x9f78,
  0x9188, 0x81a9, 0xb1ca, 0xa1eb, 0xd10c, 0xc12d, 0xf14e, 0xe16f,
]);

function calcCrc(buf) {
  let crc = 0x0000;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    crc = ((crc << 8) & 0xffff) ^ GT06_CRC_TABLE[((crc >> 8) ^ byte) & 0xff];
  }
  return crc & 0xffff;
}

// JT808 Helpers
function calcJt808Check(buf) {
  let check = 0;
  for (let i = 0; i < buf.length; i++) {
    check ^= buf[i];
  }
  return check & 0xff;
}

function escapeJt808(raw) {
  const bytes = [];
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i];
    if (b === 0x7e) bytes.push(0x7d, 0x02);
    else if (b === 0x7d) bytes.push(0x7d, 0x01);
    else bytes.push(b);
  }
  return Buffer.from(bytes);
}

function phoneToBcd(phone) {
  const digits = String(phone || "").replace(/\D/g, "").padStart(12, "0").slice(-12);
  const buf = Buffer.alloc(6);
  for (let i = 0; i < 6; i++) {
    const high = parseInt(digits[i * 2], 10) || 0;
    const low = parseInt(digits[i * 2 + 1], 10) || 0;
    buf[i] = (high << 4) | low;
  }
  return buf;
}

function buildJt808Packet(msgId, phone, seq, body) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(msgId, 0);
  header.writeUInt16BE(body.length & 0x03ff, 2);
  phoneToBcd(phone).copy(header, 4);
  header.writeUInt16BE(seq, 10);

  const payload = Buffer.concat([header, body]);
  const check = calcJt808Check(payload);
  const escaped = escapeJt808(Buffer.concat([payload, Buffer.from([check])]));
  return Buffer.concat([Buffer.from([0x7e]), escaped, Buffer.from([0x7e])]);
}

// Convert decimal degrees to NMEA string (DDMM.MMMM or DDDMM.MMMM)
function toNmea(deg, isLng) {
  const absVal = Math.abs(deg);
  const d = Math.floor(absVal);
  const m = (absVal - d) * 60;
  const dStr = isLng ? String(d).padStart(3, "0") : String(d).padStart(2, "0");
  const mStr = m.toFixed(4).padStart(7, "0");
  return `${dStr}${mStr}`;
}

// City presets (Europe & others)
const CITIES = {
  berlin: { lat: 52.5200, lng: 13.4050, name: "Berlin, Germany" },
  london: { lat: 51.5074, lng: -0.1278, name: "London, UK" },
  paris: { lat: 48.8566, lng: 2.3522, name: "Paris, France" },
  amsterdam: { lat: 52.3676, lng: 4.9041, name: "Amsterdam, Netherlands" },
  rome: { lat: 41.9028, lng: 12.4964, name: "Rome, Italy" },
  madrid: { lat: 40.4168, lng: -3.7038, name: "Madrid, Spain" },
  islamabad: { lat: 33.6844, lng: 73.0479, name: "Islamabad, Pakistan" },
};

const cityArg = (getArg("--city", "islamabad") || "islamabad").toLowerCase();
const selectedCity = CITIES[cityArg] || CITIES.islamabad;

// Path simulation origin
let curLat = parseFloat(getArg("--lat", selectedCity.lat));
let curLng = parseFloat(getArg("--lng", selectedCity.lng));
let curHeading = 45;
let curSpeed = 48; // km/h

console.log(` Location  : Starting in ${selectedCity.name} (${curLat}, ${curLng})`);

let pointIndex = 0;
let serialNumber = 1;

const socket = net.createConnection({ host, port }, () => {
  console.log(`[SIMULATOR] Connected to TCP listener on ${host}:${port}`);

  if (protocol === "jt808") {
    // Send JT808 Registration (0x0100)
    const regBody = Buffer.alloc(37 + 7);
    regBody.writeUInt16BE(0x0022, 0); // province
    regBody.writeUInt16BE(0x044e, 2); // city
    Buffer.from("70444").copy(regBody, 4); // manufacturer 5 bytes
    Buffer.from("V3_OPEN_JT808").copy(regBody, 9); // model 20 bytes
    Buffer.from("5645928").copy(regBody, 29); // terminalId 7 bytes
    regBody[36] = 0x02; // license plate color
    Buffer.from("E2E-808").copy(regBody, 37); // vehicle id

    const regPacket = buildJt808Packet(0x0100, deviceId, serialNumber++, regBody);
    console.log(`[SIMULATOR] >> Sent JT808 Registration Packet (0x0100) for Device ${deviceId}`);
    socket.write(regPacket);
  } else if (protocol === "gt06") {
    // Send GT06 Login Packet (0x01)
    const padded = deviceId.padStart(16, "0");
    const bcd = Buffer.alloc(8);
    for (let i = 0; i < 8; i++) {
      const high = parseInt(padded[i * 2], 16) || 0;
      const low = parseInt(padded[i * 2 + 1], 16) || 0;
      bcd[i] = (high << 4) | low;
    }

    const loginBuf = Buffer.alloc(18);
    loginBuf[0] = 0x78;
    loginBuf[1] = 0x78;
    loginBuf[2] = 0x0d; // Length
    loginBuf[3] = 0x01; // Protocol
    bcd.copy(loginBuf, 4);
    loginBuf.writeUInt16BE(serialNumber++, 12);
    const crc = calcCrc(loginBuf.subarray(2, 14));
    loginBuf.writeUInt16BE(crc, 14);
    loginBuf[16] = 0x0d;
    loginBuf[17] = 0x0a;

    console.log(`[SIMULATOR] >> Sent GT06 Login Packet for IMEI ${deviceId}`);
    socket.write(loginBuf);
  } else if (protocol === "coban") {
    // Send Coban Handshake
    const handshake = `##,imei:${deviceId},A;\r\n`;
    console.log(`[SIMULATOR] >> Sent Coban Handshake: ${handshake.trim()}`);
    socket.write(handshake);
  } else {
    // H02 starts directly with location packets
    startLocationStream();
  }
});

socket.on("data", (data) => {
  const hex = data.toString("hex");
  const ascii = data.toString("utf8").trim();
  console.log(`[SIMULATOR] << Received Server Response:\n   HEX  : ${hex}\n   ASCII: ${ascii}`);

  // Once login ACK or LOAD is received, start location stream
  if (pointIndex === 0) {
    startLocationStream();
  }
});

socket.on("error", (err) => {
  console.error(`[SIMULATOR] Connection error:`, err.message);
  process.exit(1);
});

socket.on("close", () => {
  console.log(`[SIMULATOR] TCP connection closed.`);
  process.exit(0);
});

function sendNextLocation() {
  if (pointIndex >= count) {
    console.log(`\n🎉 Simulation completed successfully! Sent ${count} live GPS points.`);
    socket.end();
    return;
  }

  pointIndex++;

  // Advance vehicle along path
  curLat += 0.0006 + (Math.random() - 0.5) * 0.0001;
  curLng += 0.0006 + (Math.random() - 0.5) * 0.0001;
  curSpeed = Math.round(40 + Math.random() * 20);
  curHeading = Math.round(40 + (Math.random() - 0.5) * 10) % 360;

  const now = new Date();
  const timeStr = [
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
  ].join("");

  const dateStr = [
    String(now.getUTCDate()).padStart(2, "0"),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCFullYear()).slice(-2),
  ].join("");

  if (protocol === "jt808") {
    // Build JT808 Location Report (0x0200)
    const latRaw = Math.round(curLat * 1000000);
    const lngRaw = Math.round(curLng * 1000000);

    const basicBuf = Buffer.alloc(28);
    basicBuf.writeUInt32BE(0, 0); // Warning/alarm flags
    basicBuf.writeUInt32BE(0x00000003, 4); // State flags: ACC on (1), Localized (1)
    basicBuf.writeUInt32BE(latRaw, 8); // Latitude (deg * 10^6)
    basicBuf.writeUInt32BE(lngRaw, 12); // Longitude (deg * 10^6)
    basicBuf.writeUInt16BE(45, 16); // Altitude: 45m
    basicBuf.writeUInt16BE(curSpeed * 10, 18); // Speed: 1/10 km/h
    basicBuf.writeUInt16BE(curHeading, 20); // Direction: 0-359

    // BCD[6] Date/Time in GMT+8: YY MM DD HH MM SS
    const gmt8Time = new Date(now.getTime() + 8 * 3600 * 1000);
    const toBcdByte = (n) => ((Math.floor(n / 10) & 0x0f) << 4) | (n % 10 & 0x0f);
    basicBuf[21] = toBcdByte(gmt8Time.getUTCFullYear() % 100);
    basicBuf[22] = toBcdByte(gmt8Time.getUTCMonth() + 1);
    basicBuf[23] = toBcdByte(gmt8Time.getUTCDate());
    basicBuf[24] = toBcdByte(gmt8Time.getUTCHours());
    basicBuf[25] = toBcdByte(gmt8Time.getUTCMinutes());
    basicBuf[26] = toBcdByte(gmt8Time.getUTCSeconds());

    // Additional TLV items: Mileage (0x01), GSM (0x30), Satellites (0x31), Battery (0x82)
    const extraBuf = Buffer.alloc(6 + 3 + 3 + 4);
    let offset = 0;
    extraBuf[offset++] = 0x01;
    extraBuf[offset++] = 0x04;
    extraBuf.writeUInt32BE(Math.round(pointIndex * 15), offset);
    offset += 4;
    extraBuf[offset++] = 0x30;
    extraBuf[offset++] = 0x01;
    extraBuf[offset++] = 28; // GSM signal
    extraBuf[offset++] = 0x31;
    extraBuf[offset++] = 0x01;
    extraBuf[offset++] = 16; // Satellites
    extraBuf[offset++] = 0x82;
    extraBuf[offset++] = 0x02;
    extraBuf.writeUInt16BE(124, offset); // 12.4V
    offset += 2;

    const locBody = Buffer.concat([basicBuf, extraBuf]);
    const packet = buildJt808Packet(0x0200, deviceId, serialNumber++, locBody);

    console.log(
      `[SIMULATOR] [${pointIndex}/${count}] >> JT808 Location (0x0200): Lat=${curLat.toFixed(5)}, Lng=${curLng.toFixed(5)}, Speed=${curSpeed}km/h, Heading=${curHeading}°`
    );
    socket.write(packet);
  } else if (protocol === "gt06") {
    // Build GT06 Location Packet (0x12)
    const latRaw = Math.round(curLat * 1800000);
    const lngRaw = Math.round(curLng * 1800000);

    const latBuf = Buffer.alloc(4);
    latBuf.writeUInt32BE(latRaw);
    const lngBuf = Buffer.alloc(4);
    lngBuf.writeUInt32BE(lngRaw);

    // Course status: North + GPS valid
    const courseStatus = (curHeading & 0x03ff) | 0x1000 | 0x0400;
    const courseBuf = Buffer.alloc(2);
    courseBuf.writeUInt16BE(courseStatus);

    const payload = [
      now.getUTCFullYear() - 2000,
      now.getUTCMonth() + 1,
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      0x08, // 8 satellites
      ...latBuf,
      ...lngBuf,
      curSpeed,
      ...courseBuf,
    ];

    const len = 1 + payload.length + 2 + 2;
    const packet = Buffer.alloc(len + 5);
    packet[0] = 0x78;
    packet[1] = 0x78;
    packet[2] = len;
    packet[3] = 0x12; // Protocol location
    Buffer.from(payload).copy(packet, 4);
    packet.writeUInt16BE(serialNumber++, 4 + payload.length);
    const crc = calcCrc(packet.subarray(2, 4 + payload.length + 2));
    packet.writeUInt16BE(crc, 4 + payload.length + 2);
    packet[packet.length - 2] = 0x0d;
    packet[packet.length - 1] = 0x0a;

    console.log(
      `[SIMULATOR] [${pointIndex}/${count}] >> GT06 Location: Lat=${curLat.toFixed(5)}, Lng=${curLng.toFixed(5)}, Speed=${curSpeed}km/h, Heading=${curHeading}°`
    );
    socket.write(packet);
  } else if (protocol === "coban") {
    // Coban location packet
    const nmeaLat = toNmea(curLat, false);
    const nmeaLng = toNmea(curLng, true);
    const knots = (curSpeed / 1.852).toFixed(1);
    const msg = `imei:${deviceId},tracker,${dateStr}${timeStr},,F,${timeStr}.000,A,${nmeaLat},N,${nmeaLng},E,${knots},${curHeading};\r\n`;

    console.log(
      `[SIMULATOR] [${pointIndex}/${count}] >> Coban Location: Lat=${curLat.toFixed(5)}, Lng=${curLng.toFixed(5)}, Speed=${curSpeed}km/h, Heading=${curHeading}°`
    );
    socket.write(msg);
  } else {
    // H02 Location packet
    // *HQ,ID,V1,time,A,lat,N,lng,E,speed,heading,date,FFFFFBFF#
    const nmeaLat = toNmea(curLat, false);
    const nmeaLng = toNmea(curLng, true);
    const knots = (curSpeed / 1.852).toFixed(1);
    const headingPad = String(curHeading).padStart(3, "0");
    const msg = `*HQ,${deviceId},V1,${timeStr},A,${nmeaLat},N,${nmeaLng},E,${knots},${headingPad},${dateStr},FFFFFBFF#`;

    console.log(
      `[SIMULATOR] [${pointIndex}/${count}] >> H02 Location: Lat=${curLat.toFixed(5)}, Lng=${curLng.toFixed(5)}, Speed=${curSpeed}km/h, Heading=${curHeading}°`
    );
    socket.write(msg);
  }
}

let streamInterval = null;
function startLocationStream() {
  if (streamInterval) return;
  console.log(`\n🚀 Starting live location stream (${count} points every ${intervalMs}ms)...\n`);
  sendNextLocation();
  streamInterval = setInterval(sendNextLocation, intervalMs);
}
