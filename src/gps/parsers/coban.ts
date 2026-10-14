import { ProtocolParser, ParseResult, SocketContext, ParsedGpsPacket } from "./types";
import { convertNmeaToDecimal } from "./h02";

export class CobanParser implements ProtocolParser {
  name = "COBAN";

  canParse(buf: Buffer): boolean {
    if (buf.length < 2) return false;
    const str = buf.toString("utf8", 0, Math.min(buf.length, 30));
    return (
      str.startsWith("##") ||
      str.startsWith("imei:") ||
      str.includes("imei:") ||
      str === "PING\r\n" ||
      str === "PING\n" ||
      str.startsWith("LOAD")
    );
  }

  parse(buf: Buffer, context: SocketContext): ParseResult | null {
    const rawStr = buf.toString("utf8");

    // Coban packets typically end with semicolon ';' or newline '\n'
    const semiIndex = rawStr.indexOf(";");
    const lfIndex = rawStr.indexOf("\n");

    let endIndex = -1;
    if (semiIndex !== -1 && lfIndex !== -1) {
      endIndex = Math.min(semiIndex, lfIndex);
    } else if (semiIndex !== -1) {
      endIndex = semiIndex;
    } else if (lfIndex !== -1) {
      endIndex = lfIndex;
    }

    if (endIndex === -1) {
      // Packet incomplete
      return null;
    }

    const consumedBytes = Buffer.byteLength(rawStr.slice(0, endIndex + 1), "utf8");
    const message = rawStr.slice(0, endIndex + 1).trim();

    // 1. Handshake / Login packet: ##,imei:868010341870381,A;
    if (message.startsWith("##")) {
      const match = message.match(/imei:(\d+)/i);
      if (match && match[1]) {
        const deviceId = match[1];
        context.deviceId = deviceId;
        const responseAck = Buffer.from("LOAD\r\n", "utf8");

        const packet: ParsedGpsPacket = {
          deviceId,
          latitude: 0,
          longitude: 0,
          speed: 0,
          heading: 0,
          timestamp: new Date(),
          isValid: false,
          protocol: "COBAN",
          packetType: "login",
          rawAscii: message,
          responseAck,
        };

        return {
          consumedBytes,
          packet,
          responseAck,
        };
      }
    }

    // 2. Heartbeat ping: ##,868010341870381; or PING
    if (message.includes("heartbeat") || message.startsWith("PING") || message.startsWith("##")) {
      const imeiMatch = message.match(/(\d{10,18})/);
      if (imeiMatch && imeiMatch[1]) {
        context.deviceId = imeiMatch[1];
      }

      const responseAck = Buffer.from("ON\r\n", "utf8");
      const packet: ParsedGpsPacket = {
        deviceId: context.deviceId || "UNKNOWN",
        latitude: 0,
        longitude: 0,
        speed: 0,
        heading: 0,
        timestamp: new Date(),
        isValid: false,
        protocol: "COBAN",
        packetType: "heartbeat",
        rawAscii: message,
        responseAck,
      };

      return {
        consumedBytes,
        packet,
        responseAck,
      };
    }

    // 3. Location packet
    // Example: imei:868010341870381,tracker,2610082155,,F,215500.000,A,3341.0640,N,07302.8740,E,45.2,180;
    // Or: 868010341870381,2610082155,A,3341.0640,N,07302.8740,E,45.2,180;
    const imeiMatch = message.match(/imei:(\d+)/i) || message.match(/^(\d{10,18})/);
    const deviceId = imeiMatch ? imeiMatch[1] : context.deviceId;
    if (deviceId) {
      context.deviceId = deviceId;
    }

    // Search for NMEA coordinate patterns: (DDMM.MMMM),(N|S),(DDDMM.MMMM),(E|W)
    const coordMatch = message.match(/(\d{4}\.\d+),([NS]),(\d{4,5}\.\d+),([EW])/i);
    if (deviceId && coordMatch) {
      const rawLat = coordMatch[1];
      const latDir = coordMatch[2].toUpperCase();
      const rawLng = coordMatch[3];
      const lngDir = coordMatch[4].toUpperCase();

      const latitude = convertNmeaToDecimal(rawLat, latDir);
      const longitude = convertNmeaToDecimal(rawLng, lngDir);

      let speedKm = 0;
      let heading = 0;

      const afterLng = message.substring(message.indexOf(coordMatch[0]) + coordMatch[0].length);
      const trailingParts = afterLng.split(",").filter((p) => p.length > 0);

      if (trailingParts.length >= 1) {
        const rawSpeed = parseFloat(trailingParts[0]);
        speedKm = !isNaN(rawSpeed) && rawSpeed > 0 ? Math.round(rawSpeed * 1.852) : 0;
      }
      if (trailingParts.length >= 2) {
        const rawHeading = parseFloat(trailingParts[1]);
        heading = !isNaN(rawHeading) ? Math.round(rawHeading) % 360 : 0;
      }

      const isValid = message.includes(",A,") || !message.includes(",V,");

      if (latitude != null && longitude != null) {
        const packet: ParsedGpsPacket = {
          deviceId,
          latitude,
          longitude,
          speed: speedKm,
          heading,
          timestamp: new Date(),
          isValid,
          protocol: "COBAN",
          packetType: "location",
          rawAscii: message,
        };

        return {
          consumedBytes,
          packet,
        };
      }
    }

    return { consumedBytes };
  }
}

export const cobanParser = new CobanParser();
