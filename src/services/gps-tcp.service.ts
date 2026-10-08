import net from "net";
import { processGpsPing } from "./gps-ingest.service";

/**
 * Converts Coban / NMEA format (DDMM.MMMM) to Decimal Degrees.
 * e.g., 3341.0640, N -> 33.6844
 */
function convertNmeaToDecimal(nmeaStr: string, direction: string): number | null {
  const num = parseFloat(nmeaStr);
  if (isNaN(num)) return null;

  const degrees = Math.floor(num / 100);
  const minutes = num % 100;
  let decimal = degrees + minutes / 60;

  if (direction === "S" || direction === "W") {
    decimal = -decimal;
  }
  return decimal;
}

/**
 * TCP Server for Coban GPS-403 / TK-403 / FDD-LTE hardware GPS trackers.
 */
export function startGpsTcpServer(port = Number(process.env.GPS_TCP_PORT || 5050)) {
  const server = net.createServer((socket) => {
    let deviceImei: string | null = null;
    const clientAddress = `${socket.remoteAddress}:${socket.remotePort}`;

    console.log(`[GPS-403 TCP] Device connected from ${clientAddress}`);

    socket.on("data", async (data) => {
      const message = data.toString("utf8").trim();
      console.log(`[GPS-403 TCP] Raw packet from ${clientAddress}:`, message);

      try {
        // 1. Handshake / Login packet: ##,imei:868010341870381,A;
        if (message.startsWith("##,imei:") || message.includes("imei:")) {
          const match = message.match(/imei:(\d+)/i);
          if (match && match[1]) {
            deviceImei = match[1];
            console.log(`[GPS-403 TCP] Handshake received for IMEI: ${deviceImei}`);
            // Coban protocol requires "LOAD" response to acknowledge login
            socket.write("LOAD\r\n");
            return;
          }
        }

        // 2. Heartbeat ping: ##,868010341870381; or **
        if (message.includes("heartbeat") || message === "PING") {
          socket.write("ON\r\n");
          return;
        }

        // 3. Location packet parsing
        // Example: imei:868010341870381,tracker,2610082155,,F,215500.000,A,3341.0640,N,07302.8740,E,45.2,180;
        // Or: 868010341870381,2610082155,A,3341.0640,N,07302.8740,E,45.2,180;
        const imeiMatch = message.match(/imei:(\d+)/i) || message.match(/^(\d{10,18})/);
        const currentImei = imeiMatch ? imeiMatch[1] : deviceImei;

        // Search for NMEA coordinate patterns: (DDMM.MMMM),(N|S),(DDDMM.MMMM),(E|W)
        const coordMatch = message.match(/(\d{4}\.\d+),([NS]),(\d{4,5}\.\d+),([EW])/i);

        if (currentImei && coordMatch) {
          const rawLat = coordMatch[1];
          const latDir = coordMatch[2].toUpperCase();
          const rawLng = coordMatch[3];
          const lngDir = coordMatch[4].toUpperCase();

          const latitude = convertNmeaToDecimal(rawLat, latDir);
          const longitude = convertNmeaToDecimal(rawLng, lngDir);

          // Extract speed if present (e.g., after coordinates: E,45.2,...)
          let speedKm = 0;
          const afterLng = message.substring(message.indexOf(coordMatch[0]) + coordMatch[0].length);
          const speedMatch = afterLng.match(/,(\d+(\.\d+)?)/);
          if (speedMatch) {
            const rawSpeed = parseFloat(speedMatch[1]);
            // Convert knots to km/h if in knots
            speedKm = rawSpeed > 0 ? Math.round(rawSpeed * 1.852) : 0;
          }

          if (latitude != null && longitude != null) {
            console.log(
              `[GPS-403 TCP] Parsed: IMEI=${currentImei}, Lat=${latitude.toFixed(5)}, Lng=${longitude.toFixed(5)}, Speed=${speedKm} km/h`
            );

            const result = await processGpsPing({
              deviceId: currentImei,
              latitude,
              longitude,
              speed: speedKm,
              recordedAt: new Date(),
            });

            if (result.success) {
              console.log(`[GPS-403 TCP] ✅ Successfully saved GPS point for ${result.vehicleName}`);
            } else {
              console.warn(`[GPS-403 TCP] ⚠️ Ingest warning: ${result.error}`);
            }
          }
        }
      } catch (err: any) {
        console.error(`[GPS-403 TCP] Error processing packet:`, err.message);
      }
    });

    socket.on("error", (err) => {
      console.warn(`[GPS-403 TCP] Socket error from ${clientAddress}:`, err.message);
    });

    socket.on("close", () => {
      console.log(`[GPS-403 TCP] Device disconnected: ${clientAddress}`);
    });
  });

  server.listen(port, () => {
    console.log(`📡 Coban GPS-403 Hardware TCP Listener active on port ${port}`);
  });

  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`[GPS-403 TCP] Port ${port} is in use; continuing without TCP listener`);
    } else {
      console.error(`[GPS-403 TCP] Server error:`, err);
    }
  });

  return server;
}
