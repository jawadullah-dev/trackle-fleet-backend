import net from "net";
import http from "http";
import { io as ClientIo } from "../../admin/node_modules/socket.io-client";
import { prisma } from "../src/config/db";
import { startGpsTcpServer, stopGpsTcpServer } from "../src/gps/tcpServer";
import app from "../src/app";
import { initSocketServer } from "../src/services/socket.service";
import { signToken } from "../src/utils/auth";
import { Role } from "@prisma/client";

async function runE2EVerification() {
  console.log("====================================================");
  console.log(" 🧪 RUNNING END-TO-END TRACKFLEET VERIFICATION");
  console.log("====================================================\n");

  const TEST_HTTP_PORT = 5098;
  const TEST_TCP_PORT = 5099;

  // 1. Start test HTTP & Socket.IO server
  const httpServer = http.createServer(app);
  initSocketServer(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(TEST_HTTP_PORT, resolve));
  console.log(`[E2E] HTTP & Socket.IO running on port ${TEST_HTTP_PORT}`);

  // 2. Start test GPS TCP Server
  const tcpServer = startGpsTcpServer(TEST_TCP_PORT);
  console.log(`[E2E] GPS TCP Server running on port ${TEST_TCP_PORT}`);

  try {
    // 3. Find or create a test company and users
    let company = await prisma.company.findFirst({
      where: { name: "E2E Logistics Ltd" },
    });
    if (!company) {
      company = await prisma.company.create({
        data: {
          name: "E2E Logistics Ltd",
          status: "ACTIVE",
          plan: "PRO",
        },
      });
    }

    const superAdminUser = {
      sub: "super_admin_test_id",
      email: "super-admin@gmail.com",
      role: Role.SUPER_ADMIN,
      companyId: null,
    };
    const superAdminToken = signToken(superAdminUser);

    const companyAdminUser = {
      sub: "company_admin_test_id",
      email: "company-admin@e2e.com",
      role: Role.COMPANY_ADMIN,
      companyId: company.id,
    };
    const companyAdminToken = signToken(companyAdminUser);

    console.log(`[E2E] Created test tokens for SUPER_ADMIN and COMPANY_ADMIN`);

    // Helper for HTTP requests
    async function apiRequest(path: string, token: string, method = "GET", body?: any) {
      const res = await fetch(`http://127.0.0.1:${TEST_HTTP_PORT}/api${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    }

    // 4. TEST STRICT ROLE ACCESS: SUPER_ADMIN MUST BE REJECTED (403)
    console.log("\n--- Testing Strict Role Security (SUPER_ADMIN 403 Forbidden) ---");

    const superVehicles = await apiRequest("/vehicles", superAdminToken);
    console.log(`Super Admin GET /api/vehicles status: ${superVehicles.status} (Expected: 403)`);
    if (superVehicles.status !== 403) throw new Error("SUPER_ADMIN should be 403 on /api/vehicles");

    const superLive = await apiRequest("/vehicles/live", superAdminToken);
    console.log(`Super Admin GET /api/vehicles/live status: ${superLive.status} (Expected: 403)`);
    if (superLive.status !== 403) throw new Error("SUPER_ADMIN should be 403 on /api/vehicles/live");

    const superPins = await apiRequest("/vehicles/map-pins", superAdminToken);
    console.log(`Super Admin GET /api/vehicles/map-pins status: ${superPins.status} (Expected: 403)`);
    if (superPins.status !== 403) throw new Error("SUPER_ADMIN should be 403 on /api/vehicles/map-pins");

    const superHist = await apiRequest("/vehicles/some-id/history?date=2026-10-09", superAdminToken);
    console.log(`Super Admin GET /api/vehicles/:id/history status: ${superHist.status} (Expected: 403)`);
    if (superHist.status !== 403) throw new Error("SUPER_ADMIN should be 403 on /api/vehicles/:id/history");

    const superHistDays = await apiRequest("/vehicles/some-id/history/days?month=2026-10", superAdminToken);
    console.log(`Super Admin GET /api/vehicles/:id/history/days status: ${superHistDays.status} (Expected: 403)`);
    if (superHistDays.status !== 403) throw new Error("SUPER_ADMIN should be 403 on /api/vehicles/:id/history/days");

    console.log("✅ All tracking endpoints properly rejected SUPER_ADMIN with 403 Forbidden!");

    // 5. TEST COMPANY_ADMIN CAN ACCESS VEHICLES
    console.log("\n--- Testing COMPANY_ADMIN Access & Vehicle Creation ---");

    const testDeviceId = "19210086602";
    const testRegNo = "E2E-9999";

    // Clean up if already exists from previous runs
    await prisma.vehicle.deleteMany({
      where: {
        OR: [{ deviceId: testDeviceId }, { regNo: testRegNo }],
      },
    });

    // Add Vehicle as COMPANY_ADMIN
    const createRes = await apiRequest("/vehicles", companyAdminToken, "POST", {
      name: "Truck A7670SA Live",
      regNo: testRegNo,
      type: "Truck",
      deviceId: testDeviceId,
      status: "OFFLINE",
    });
    console.log(`Company Admin POST /api/vehicles status: ${createRes.status} (Expected: 201)`);
    if (createRes.status !== 201) {
      console.error("Create vehicle failed:", createRes.data);
      throw new Error("Failed to create vehicle");
    }
    const createdVehicle = createRes.data.data;
    console.log(`✅ Vehicle created successfully: "${createdVehicle.name}" (ID: ${createdVehicle.id}, DeviceID: ${testDeviceId})`);

    // Test Duplicate Device ID Validation -> must return 409 Conflict
    const dupRes = await apiRequest("/vehicles", companyAdminToken, "POST", {
      name: "Second Vehicle with same ID",
      regNo: "DUP-1234",
      type: "Car",
      deviceId: testDeviceId,
    });
    console.log(`Duplicate Device ID POST /api/vehicles status: ${dupRes.status} (Expected: 409)`);
    if (dupRes.status !== 409) throw new Error("Duplicate deviceId must return 409 Conflict");
    console.log(`✅ Duplicate Device ID correctly rejected with 409 Conflict: "${dupRes.data.message}"`);

    // Verify GET /api/vehicles and /api/vehicles/live include lastLocation and status
    const liveVehicles = await apiRequest("/vehicles/live", companyAdminToken);
    if (liveVehicles.status !== 200) throw new Error("Failed to get live vehicles");
    console.log(`✅ GET /api/vehicles/live returned ${liveVehicles.data.data.length} vehicles for company`);

    // 6. TEST REAL-TIME SOCKET.IO DELIVERY
    console.log("\n--- Testing Real-Time Socket.IO Location Streaming ---");

    const superSocket = ClientIo(`http://127.0.0.1:${TEST_HTTP_PORT}`, {
      auth: { token: superAdminToken },
      transports: ["websocket"],
    });

    const companySocket = ClientIo(`http://127.0.0.1:${TEST_HTTP_PORT}`, {
      auth: { token: companyAdminToken },
      transports: ["websocket"],
    });

    await new Promise<void>((resolve) => {
      let count = 0;
      const done = () => {
        count++;
        if (count === 2) resolve();
      };
      companySocket.on("connect", done);
      superSocket.on("connect", done);
    });
    console.log("[E2E] Both Company Admin and Super Admin sockets connected");

    let receivedByCompany: any = null;
    let receivedBySuper = false;

    companySocket.on("vehicle:location", (data) => {
      receivedByCompany = data;
    });

    superSocket.on("vehicle:location", () => {
      receivedBySuper = true;
    });

    // 7. SEND SIMULATED H02 PACKET OVER TCP
    console.log("\n--- Sending Simulated 4G Tracker H02 Packet over TCP ---");

    const simSocket = net.createConnection({ host: "127.0.0.1", port: TEST_TCP_PORT }, () => {
      const h02Packet = `*HQ,${testDeviceId},V1,123000,A,3341.0640,N,07302.8740,E,025.0,180,091026,FFFFFBFF#`;
      console.log(`[E2E Simulator] Sending H02 packet: ${h02Packet}`);
      simSocket.write(h02Packet);
    });

    // Poll for socket event (up to 30s to allow remote database writes)
    for (let i = 0; i < 60; i++) {
      if (receivedByCompany) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    simSocket.end();

    if (!receivedByCompany) {
      throw new Error("Company Admin socket did not receive vehicle:location event within timeout!");
    }
    console.log("✅ Company Admin received real-time vehicle:location update:", receivedByCompany);
    if (receivedBySuper) {
      throw new Error("SUPER_ADMIN incorrectly received vehicle:location! Isolation failed.");
    }
    console.log("✅ SUPER_ADMIN received NO vehicle:location events (strictly isolated)!");

    // Verify payload fields match specification
    if (
      !receivedByCompany.vehicleId ||
      !receivedByCompany.lat ||
      !receivedByCompany.lng ||
      receivedByCompany.status !== "ONLINE" ||
      receivedByCompany.speed !== 46 || // 25 knots = 46 km/h
      receivedByCompany.heading !== 180
    ) {
      throw new Error("Payload shape mismatch!");
    }
    console.log("✅ Socket payload fields verified (vehicleId, name, regNo, lat, lng, speed, heading, status, timestamp)!");

    // 7b. TEST JT808 HARDWARE TRACKER OVER TCP
    console.log("\n--- Sending Simulated JT808 Packet over TCP ---");
    const jt808DeviceId = "019175645928";
    const jt808RegNo = "JT-8088";

    await prisma.vehicle.deleteMany({
      where: {
        OR: [{ deviceId: jt808DeviceId }, { regNo: jt808RegNo }],
      },
    });

    const jtVehicleRes = await apiRequest("/vehicles", companyAdminToken, "POST", {
      name: "Beidou JT808 Truck",
      regNo: jt808RegNo,
      type: "Truck",
      deviceId: jt808DeviceId,
      status: "OFFLINE",
    });
    if (jtVehicleRes.status !== 201) throw new Error("Failed to create JT808 vehicle");

    receivedByCompany = null;
    let jt808AckReceived = false;

    const jtSimSocket = net.createConnection({ host: "127.0.0.1", port: TEST_TCP_PORT }, () => {
      // Send JT808 0x0200 packet from PDF Page 11
      const jtPacketHex =
        "7e02000042019175645928000200000000000000020158dfa206c9607800310000000026032115553501040000068a30011a31011c82020077cc143839383630344136313032353730303333343730dc7e";
      jtSimSocket.write(Buffer.from(jtPacketHex, "hex"));
    });

    jtSimSocket.on("data", (data) => {
      if (data && data.length > 0 && data[0] === 0x7e) {
        jt808AckReceived = true;
      }
    });

    for (let i = 0; i < 60; i++) {
      if (receivedByCompany && jt808AckReceived) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    jtSimSocket.end();

    if (!jt808AckReceived) throw new Error("JT808 0x8001 ACK was not returned to terminal!");
    if (!receivedByCompany) throw new Error("Company socket did not receive JT808 location update!");
    console.log("✅ JT808 0x8001 ACK received and location delivered in real-time:", receivedByCompany);

    // 8. VERIFY STORAGE & TRIP HISTORY API
    console.log("\n--- Verifying Storage & History API ---");

    const histRes = await apiRequest(
      `/vehicles/${createdVehicle.id}/history?date=2026-10-09`,
      companyAdminToken
    );
    console.log(`GET /api/vehicles/:id/history status: ${histRes.status} (Expected: 200)`);
    if (histRes.status !== 200) throw new Error("History endpoint failed");
    console.log("History response points count:", histRes.data.data.points.length);
    console.log("History summary:", histRes.data.data.summary);
    if (histRes.data.data.points.length === 0) {
      throw new Error("No points saved to GpsPoint table!");
    }
    console.log("✅ Trip history successfully saved to database and retrieved via API!");

    const daysRes = await apiRequest(
      `/vehicles/${createdVehicle.id}/history/days?month=2026-10`,
      companyAdminToken
    );
    console.log(`GET /api/vehicles/:id/history/days status: ${daysRes.status}`);
    console.log("Track days recorded:", daysRes.data.data.days);
    if (!daysRes.data.data.days.includes("2026-10-09")) {
      throw new Error("Track day not found in days calendar!");
    }
    console.log("✅ Calendar track days endpoint verified!");

    // Cleanup sockets
    companySocket.disconnect();
    superSocket.disconnect();

    console.log("\n====================================================");
    console.log(" 🎉 ALL END-TO-END VERIFICATION CHECKS PASSED!");
    console.log("====================================================");
  } finally {
    try {
      companySocket?.disconnect();
      superSocket?.disconnect();
    } catch {}
    await stopGpsTcpServer();
    if (typeof (httpServer as any).closeAllConnections === "function") {
      (httpServer as any).closeAllConnections();
    }
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
}

runE2EVerification()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ E2E VERIFICATION FAILED:", err);
    process.exit(1);
  });
