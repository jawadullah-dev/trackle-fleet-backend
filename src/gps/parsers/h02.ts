import { ProtocolParser, ParseResult, SocketContext, ParsedGpsPacket } from "./types";

/**
 * Converts NMEA coordinate format (DDMM.MMMM or DDDMM.MMMM) to Decimal Degrees.
 * e.g., "3341.0640", "N" -> 33.6844
 *       "07302.8740", "E" -> 73.0479
 */
export function convertNmeaToDecimal(
  rawCoord: string | number,
  direction: string
): number | null {
  const num = typeof rawCoord === "number" ? rawCoord : parseFloat(String(rawCoord));
  if (isNaN(num) || num === 0) return null;

  const degrees = Math.floor(num / 100);
  const minutes = num % 100;
  let decimal = degrees + minutes / 60;

  const dir = (direction || "").toUpperCase();
  if (dir === "S" || dir === "W") {
    decimal = -decimal;
  }
  return decimal;
}

/**
 * Parses H02 date (DDMMYY) and time (HHMMSS) into a JavaScript Date object.
 */
export function parseH02DateTime(timeStr: string, dateStr: string): Date {
  try {
    const t = String(timeStr || "").padStart(6, "0");
    const d = String(dateStr || "").padStart(6, "0");

    const hours = parseInt(t.slice(0, 2), 10) || 0;
    const minutes = parseInt(t.slice(2, 4), 10) || 0;
    const seconds = parseInt(t.slice(4, 6), 10) || 0;

    const day = parseInt(d.slice(0, 2), 10) || 1;
    const month = (parseInt(d.slice(2, 4), 10) || 1) - 1; // 0-indexed
    let year = parseInt(d.slice(4, 6), 10) || 0;
    year += year < 70 ? 2000 : 1900;

    return new Date(Date.UTC(year, month, day, hours, minutes, seconds));
  } catch {
    return new Date();
  }
}

/**
 * H02 Protocol Parser
 * Supports text packets starting with '*' and ending with '#':
 * Standard location (V1):
 * *HQ,19210086602,V1,123456,A,2234.5678,N,11405.6789,E,000.0,000,091026,FFFFFBFF#
 */
export class H02Parser implements ProtocolParser {
  name = "H02";

  canParse(buf: Buffer): boolean {
    if (buf.length === 0) return false;
    // Check if starts with '*' (ASCII 0x2A)
    return buf[0] === 0x2a;
  }

  parse(buf: Buffer, context: SocketContext): ParseResult | null {
    const startIndex = buf.indexOf(0x2a); // '*'
    if (startIndex === -1) return null;

    const endIndex = buf.indexOf(0x23, startIndex); // '#'
    if (endIndex === -1) {
      // Complete packet not yet received
      return null;
    }

    const consumedBytes = endIndex + 1;
    const packetBuffer = buf.subarray(startIndex, consumedBytes);
    const rawAscii = packetBuffer.toString("utf8");

    // Remove leading '*' and trailing '#'
    const content = rawAscii.slice(1, -1);
    const parts = content.split(",");

    if (parts.length < 3) {
      return { consumedBytes };
    }

    // parts[0] = Manufacturer / Prefix (e.g. "HQ", "XX", "TS")
    // parts[1] = Device ID / IMEI (e.g. "19210086602")
    const deviceId = parts[1].trim();
    if (deviceId) {
      context.deviceId = deviceId;
    }

    const cmd = parts[2].toUpperCase();

    // Standard V1 location packet
    // *HQ,ID,V1,time,status,lat,latDir,lng,lngDir,speed,heading,date,vehicleStatus#
    if (cmd === "V1" && parts.length >= 12) {
      const timeStr = parts[3];
      const statusFlag = parts[4].toUpperCase(); // 'A' = valid, 'V' = invalid
      const isValid = statusFlag === "A";

      const rawLat = parts[5];
      const latDir = parts[6];
      const rawLng = parts[7];
      const lngDir = parts[8];

      const latitude = convertNmeaToDecimal(rawLat, latDir);
      const longitude = convertNmeaToDecimal(rawLng, lngDir);

      const rawSpeed = parseFloat(parts[9]) || 0;
      // H02 speed is typically in knots (1 knot = 1.852 km/h) or km/h
      const speedKm = Math.round(rawSpeed > 0 ? rawSpeed * 1.852 : 0);

      const heading = Math.round(parseFloat(parts[10]) || 0) % 360;
      const dateStr = parts[11];

      const timestamp = parseH02DateTime(timeStr, dateStr);

      let ignition: boolean | undefined = undefined;
      if (parts[12]) {
        // Vehicle status hex flag (e.g., FFFFFBFF)
        // Bit 22 is commonly ACC status in H02
        try {
          const statusVal = parseInt(parts[12], 16);
          if (!isNaN(statusVal)) {
            // Check bit (standard H02 has ACC off if bit inverted or active high)
            ignition = (statusVal & 0x00000400) !== 0;
          }
        } catch {
          // ignore
        }
      }

      if (latitude != null && longitude != null) {
        const packet: ParsedGpsPacket = {
          deviceId: deviceId || context.deviceId || "UNKNOWN",
          latitude,
          longitude,
          speed: speedKm,
          heading,
          timestamp,
          isValid,
          protocol: "H02",
          packetType: "location",
          rawAscii,
          rawHex: packetBuffer.toString("hex"),
          ignition,
        };

        return {
          consumedBytes,
          packet,
        };
      }
    }

    // Heartbeat / Link packet
    if (cmd === "LINK" || cmd === "V4") {
      const packet: ParsedGpsPacket = {
        deviceId: deviceId || context.deviceId || "UNKNOWN",
        latitude: 0,
        longitude: 0,
        speed: 0,
        heading: 0,
        timestamp: new Date(),
        isValid: false,
        protocol: "H02",
        packetType: "heartbeat",
        rawAscii,
        rawHex: packetBuffer.toString("hex"),
      };
      return { consumedBytes, packet };
    }

    return { consumedBytes };
  }
}

export const h02Parser = new H02Parser();
