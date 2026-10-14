import net from "net";
import { autoDetectAndParse, SocketContext } from "./parsers";
import { processGpsPing } from "../services/gps-ingest.service";

let gpsServerInstance: net.Server | null = null;

/**
 * Starts the GPS TCP Server for hardware 4G/2G trackers (H02, GT06, Coban, etc.)
 */
export function startGpsTcpServer(
  port = Number(process.env.GPS_TCP_PORT || 5023)
): net.Server {
  const isDebug = process.env.GPS_DEBUG === "true" || process.env.GPS_DEBUG === "1" || !process.env.GPS_DEBUG;

  const server = net.createServer((socket) => {
    const remoteAddress = `${socket.remoteAddress}:${socket.remotePort}`;
    const socketId = `sock_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const context: SocketContext = {
      socketId,
      remoteAddress,
      lastPacketAt: new Date(),
    };

    console.log(`[GPS TCP] 📡 Tracker connected from ${remoteAddress} (${socketId})`);

    // Per-socket buffer to handle partial chunks and concatenated TCP packets
    let buffer = Buffer.alloc(0);

    socket.on("data", async (chunk: Buffer) => {
      context.lastPacketAt = new Date();

      // Step 1: Raw packet logging (HEX and ASCII) for real hardware protocol identification
      if (isDebug) {
        const hexStr = chunk.toString("hex");
        // Replace non-printable ASCII with '.'
        const asciiStr = chunk.toString("utf8").replace(/[\x00-\x1F\x7F-\x9F]/g, ".");
        console.log(
          `[GPS TCP RAW] << ${remoteAddress} [${chunk.length} bytes]\n` +
          `   HEX  : ${hexStr}\n` +
          `   ASCII: ${asciiStr}`
        );
      }

      // Append incoming chunk to per-socket buffer
      buffer = Buffer.concat([buffer, chunk]);

      // Guard against buffer overflow if data is corrupt
      if (buffer.length > 8192) {
        console.warn(`[GPS TCP] Buffer exceeded 8KB for ${remoteAddress}, slicing to last 2KB`);
        buffer = buffer.subarray(buffer.length - 2048);
      }

      // Step 2: Loop through buffer to extract and parse all complete packets
      while (buffer.length > 0) {
        try {
          const parseResult = autoDetectAndParse(buffer, context);

          // If null, packet is incomplete; wait for next TCP chunk
          if (!parseResult) {
            break;
          }

          const { consumedBytes, packet, responseAck } = parseResult;

          // Consume the parsed bytes from buffer
          if (consumedBytes > 0) {
            buffer = buffer.subarray(consumedBytes);
          } else {
            // Safety break to prevent infinite loop
            buffer = buffer.subarray(1);
          }

          // If parser produced an ACK response (e.g. GT06 login/heartbeat ACK, Coban LOAD/ON), send it back
          if (responseAck && responseAck.length > 0) {
            socket.write(responseAck);
            if (isDebug) {
              console.log(
                `[GPS TCP ACK] >> ${remoteAddress} (${context.detectedProtocol || "ACK"})\n` +
                `   HEX  : ${responseAck.toString("hex")}\n` +
                `   ASCII: ${responseAck.toString("utf8").replace(/[\x00-\x1F\x7F-\x9F]/g, ".")}`
              );
            }
          }

          // If a location packet was parsed, forward it to the ingestion service
          if (packet && packet.packetType === "location") {
            if (isDebug) {
              console.log(
                `[GPS TCP PARSED] Device=${packet.deviceId} Protocol=${packet.protocol} ` +
                `Lat=${packet.latitude.toFixed(6)} Lng=${packet.longitude.toFixed(6)} ` +
                `Speed=${packet.speed}km/h Heading=${packet.heading}° Valid=${packet.isValid}`
              );
            }

            // Ingest and broadcast
            await processGpsPing({
              deviceId: packet.deviceId,
              latitude: packet.latitude,
              longitude: packet.longitude,
              speed: packet.speed,
              heading: packet.heading,
              isValid: packet.isValid,
              recordedAt: packet.timestamp,
            });
          } else if (packet) {
            if (isDebug) {
              console.log(
                `[GPS TCP EVENT] Device=${packet.deviceId} Protocol=${packet.protocol} Type=${packet.packetType}`
              );
            }
          }
        } catch (err: any) {
          console.error(`[GPS TCP] Error while processing buffer from ${remoteAddress}:`, err.message);
          // Drop 1 byte and continue
          buffer = buffer.subarray(1);
        }
      }
    });

    socket.on("error", (err: any) => {
      console.warn(`[GPS TCP] Socket error from ${remoteAddress}:`, err.message);
    });

    socket.on("close", () => {
      console.log(`[GPS TCP] Device disconnected: ${remoteAddress} (${context.deviceId || "unknown ID"})`);
    });

    // Socket timeout after 10 minutes of inactivity
    socket.setTimeout(600000, () => {
      console.log(`[GPS TCP] Connection timeout for ${remoteAddress}`);
      socket.end();
    });
  });

  server.listen(port, () => {
    console.log(`📡 Multi-Protocol GPS Hardware TCP Listener active on port ${port} (Protocols: JT808, GT06, H02, COBAN)`);
  });

  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`[GPS TCP] Port ${port} is in use; continuing without new TCP listener on port ${port}`);
    } else {
      console.error(`[GPS TCP] Server error:`, err);
    }
  });

  gpsServerInstance = server;
  return server;
}

export function stopGpsTcpServer(): Promise<void> {
  return new Promise((resolve) => {
    if (gpsServerInstance) {
      gpsServerInstance.close(() => {
        gpsServerInstance = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}
