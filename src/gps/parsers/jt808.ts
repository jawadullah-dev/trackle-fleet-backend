import { ProtocolParser, ParseResult, SocketContext, ParsedGpsPacket } from "./types";

/**
 * JT/T 808 (JT808) Protocol Parser
 * Road Transport Vehicle Satellite Positioning System
 * Technical Specification for Beidou/GPS In-Vehicle Terminal Communication Protocol
 * (Ministry of Transport of PRC)
 */

/**
 * Converts a 6-byte BCD buffer into a phone number / device ID string.
 * Example: [0x01, 0x91, 0x75, 0x64, 0x59, 0x28] -> "019175645928"
 */
export function bcdToPhoneString(buf: Buffer): string {
  let result = "";
  for (let i = 0; i < buf.length; i++) {
    const high = (buf[i] >> 4) & 0x0f;
    const low = buf[i] & 0x0f;
    result += high.toString(10) + low.toString(10);
  }
  return result;
}

/**
 * Converts a phone number string into a 6-byte BCD buffer (12 digits padded with leading zeros).
 * Example: "019175645928" -> Buffer.from([0x01, 0x91, 0x75, 0x64, 0x59, 0x28])
 */
export function phoneStringToBcd(phone: string): Buffer {
  const digits = String(phone || "").replace(/\D/g, "").padStart(12, "0").slice(-12);
  const buf = Buffer.alloc(6);
  for (let i = 0; i < 6; i++) {
    const high = parseInt(digits[i * 2], 10) || 0;
    const low = parseInt(digits[i * 2 + 1], 10) || 0;
    buf[i] = (high << 4) | low;
  }
  return buf;
}

/**
 * Calculates XOR checksum across the unescaped message (from Header to last body byte).
 */
export function calculateJt808CheckCode(data: Buffer): number {
  let check = 0;
  for (let i = 0; i < data.length; i++) {
    check ^= data[i];
  }
  return check & 0xff;
}

/**
 * Escapes bytes according to JT808 specification:
 * 0x7e <--> 0x7d 0x02
 * 0x7d <--> 0x7d 0x01
 */
export function escapeJt808(raw: Buffer): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i];
    if (b === 0x7e) {
      bytes.push(0x7d, 0x02);
    } else if (b === 0x7d) {
      bytes.push(0x7d, 0x01);
    } else {
      bytes.push(b);
    }
  }
  return Buffer.from(bytes);
}

/**
 * Reverses escaping according to JT808 specification:
 * 0x7d 0x02 -> 0x7e
 * 0x7d 0x01 -> 0x7d
 */
export function unescapeJt808(escaped: Buffer): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < escaped.length; i++) {
    if (escaped[i] === 0x7d && i + 1 < escaped.length) {
      const next = escaped[i + 1];
      if (next === 0x02) {
        bytes.push(0x7e);
        i++;
      } else if (next === 0x01) {
        bytes.push(0x7d);
        i++;
      } else {
        bytes.push(escaped[i]);
      }
    } else {
      bytes.push(escaped[i]);
    }
  }
  return Buffer.from(bytes);
}

/**
 * Parses JT808 6-byte BCD timestamp (YY-MM-DD-hh-mm-ss, standard specifies GMT+8).
 */
export function parseJt808Timestamp(buf: Buffer): Date {
  try {
    const getBcdByte = (byte: number) => {
      const high = (byte >> 4) & 0x0f;
      const low = byte & 0x0f;
      return high * 10 + low;
    };

    const yy = getBcdByte(buf[0]);
    const month = getBcdByte(buf[1]);
    const day = getBcdByte(buf[2]);
    const hour = getBcdByte(buf[3]);
    const min = getBcdByte(buf[4]);
    const sec = getBcdByte(buf[5]);

    const fullYear = 2000 + yy;
    // JT808 standard defines time in GMT+8 (Beijing time)
    // Convert to UTC by subtracting 8 hours
    const utcMillis = Date.UTC(fullYear, month - 1, day, hour - 8, min, sec);
    const d = new Date(utcMillis);
    if (isNaN(d.getTime())) return new Date();
    return d;
  } catch {
    return new Date();
  }
}

/**
 * Builds a complete JT808 response packet:
 * 0x7E + [escaped(header + body + XOR)] + 0x7E
 */
export function buildJt808Packet(
  msgId: number,
  phoneStr: string,
  serverSeq: number,
  body: Buffer
): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(msgId, 0); // Message ID
  header.writeUInt16BE(body.length & 0x03ff, 2); // Body properties (unencrypted, no subpack)
  const phoneBcd = phoneStringToBcd(phoneStr);
  phoneBcd.copy(header, 4); // BCD[6] Phone / Device ID
  header.writeUInt16BE(serverSeq, 10); // Message sequence number

  const unescapedContent = Buffer.concat([header, body]);
  const checkCode = calculateJt808CheckCode(unescapedContent);
  const withCheck = Buffer.concat([unescapedContent, Buffer.from([checkCode])]);
  const escaped = escapeJt808(withCheck);

  return Buffer.concat([Buffer.from([0x7e]), escaped, Buffer.from([0x7e])]);
}

/**
 * Builds Platform Generic Response (0x8001):
 * - Response sequential number (WORD)
 * - Reply ID (WORD)
 * - Results (BYTE): 0: Success/Confirmed, 1: Failed, 2: Invalid message, 3: Not supported
 */
export function buildJt808GenericResponse(
  replySeq: number,
  replyId: number,
  phoneStr: string,
  result = 0,
  serverSeq = 1
): Buffer {
  const body = Buffer.alloc(5);
  body.writeUInt16BE(replySeq, 0);
  body.writeUInt16BE(replyId, 2);
  body[4] = result;
  return buildJt808Packet(0x8001, phoneStr, serverSeq, body);
}

/**
 * Builds Terminal Registration Response (0x8100):
 * - Response sequential number (WORD)
 * - Results (BYTE): 0: Success, 1: Vehicle already registered, 2: Vehicle not found, 3: Terminal already registered, 4: Terminal not found
 * - Authentication code (STRING): only present on success
 */
export function buildJt808RegistrationResponse(
  replySeq: number,
  phoneStr: string,
  result = 0,
  authCode = "AUTH808",
  serverSeq = 1
): Buffer {
  const authBuf = result === 0 ? Buffer.from(authCode, "ascii") : Buffer.alloc(0);
  const body = Buffer.alloc(3 + authBuf.length);
  body.writeUInt16BE(replySeq, 0);
  body[2] = result;
  if (authBuf.length > 0) {
    authBuf.copy(body, 3);
  }
  return buildJt808Packet(0x8100, phoneStr, serverSeq, body);
}

let jt808ServerSeqCounter = 1;

/**
 * JT808 Protocol Parser Implementation
 */
export class Jt808Parser implements ProtocolParser {
  name = "JT808";

  canParse(buf: Buffer): boolean {
    if (buf.length < 2) return false;
    // JT808 packets always start with 0x7E
    return buf[0] === 0x7e;
  }

  parse(buf: Buffer, context: SocketContext): ParseResult | null {
    if (buf.length < 2) return null;

    // Find the opening 0x7E
    const startIndex = buf.indexOf(0x7e);
    if (startIndex === -1) return null;

    // Find the closing 0x7E after the opening 0x7E
    const endIndex = buf.indexOf(0x7e, startIndex + 1);
    if (endIndex === -1) {
      // Incomplete packet in buffer; wait for next TCP chunk
      return null;
    }

    const consumedBytes = endIndex + 1;
    // Extract raw packet including both 0x7E delimiters
    const rawPacket = buf.subarray(startIndex, endIndex + 1);

    // The data to unescape is between the opening and closing 0x7E
    const innerEscaped = rawPacket.subarray(1, rawPacket.length - 1);
    const unescaped = unescapeJt808(innerEscaped);

    // Minimum JT808 message size: Header (12 bytes) + Check code (1 byte) = 13 bytes
    if (unescaped.length < 13) {
      return { consumedBytes };
    }

    // Verify Check Code (last byte)
    const expectedCheck = unescaped[unescaped.length - 1];
    const dataToCheck = unescaped.subarray(0, unescaped.length - 1);
    const calculatedCheck = calculateJt808CheckCode(dataToCheck);

    if (expectedCheck !== calculatedCheck) {
      console.warn(
        `[JT808] Checksum mismatch from ${context.remoteAddress}: expected 0x${expectedCheck.toString(16)}, got 0x${calculatedCheck.toString(16)}`
      );
      // Consume this corrupted packet and continue
      return { consumedBytes };
    }

    // Parse Header
    const msgId = unescaped.readUInt16BE(0);
    const bodyProps = unescaped.readUInt16BE(2);
    const bodyLength = bodyProps & 0x03ff;
    const isSubpackage = (bodyProps & 0x2000) !== 0;

    const phoneBcd = unescaped.subarray(4, 10);
    const phoneStr = bcdToPhoneString(phoneBcd);
    const msgSeq = unescaped.readUInt16BE(10);

    const headerSize = isSubpackage ? 16 : 12;
    const body = unescaped.subarray(headerSize, headerSize + bodyLength);

    context.deviceId = phoneStr;
    const currentServerSeq = jt808ServerSeqCounter++ & 0xffff;

    // 1. TERMINAL REGISTRATION (0x0100) -> Return 0x8100 Response
    if (msgId === 0x0100) {
      const responseAck = buildJt808RegistrationResponse(
        msgSeq,
        phoneStr,
        0, // Success
        phoneStr,
        currentServerSeq
      );

      const packet: ParsedGpsPacket = {
        deviceId: phoneStr,
        latitude: 0,
        longitude: 0,
        speed: 0,
        heading: 0,
        timestamp: new Date(),
        isValid: false,
        protocol: "JT808",
        packetType: "login",
        rawHex: rawPacket.toString("hex"),
        responseAck,
      };

      return {
        consumedBytes,
        packet,
        responseAck,
      };
    }

    // 2. TERMINAL AUTHENTICATION (0x0102) -> Return 0x8001 Response
    if (msgId === 0x0102) {
      const responseAck = buildJt808GenericResponse(
        msgSeq,
        0x0102,
        phoneStr,
        0, // Success
        currentServerSeq
      );

      const packet: ParsedGpsPacket = {
        deviceId: phoneStr,
        latitude: 0,
        longitude: 0,
        speed: 0,
        heading: 0,
        timestamp: new Date(),
        isValid: false,
        protocol: "JT808",
        packetType: "login",
        rawHex: rawPacket.toString("hex"),
        responseAck,
      };

      return {
        consumedBytes,
        packet,
        responseAck,
      };
    }

    // 3. TERMINAL HEARTBEAT (0x0002) -> Return 0x8001 Response
    if (msgId === 0x0002) {
      const responseAck = buildJt808GenericResponse(
        msgSeq,
        0x0002,
        phoneStr,
        0, // Success
        currentServerSeq
      );

      const packet: ParsedGpsPacket = {
        deviceId: phoneStr,
        latitude: 0,
        longitude: 0,
        speed: 0,
        heading: 0,
        timestamp: new Date(),
        isValid: false,
        protocol: "JT808",
        packetType: "heartbeat",
        rawHex: rawPacket.toString("hex"),
        responseAck,
      };

      return {
        consumedBytes,
        packet,
        responseAck,
      };
    }

    // 4. LOCATION INFORMATION REPORT (0x0200) -> Return 0x8001 Response
    if (msgId === 0x0200 && body.length >= 28) {
      // Basic location information (28 bytes)
      const warningMark = body.readUInt32BE(0);
      const stateFlags = body.readUInt32BE(4);

      // Status bit definitions (Table 25):
      // Bit 0: ACC (0: ACC Off, 1: ACC On)
      const ignition = (stateFlags & 0x00000001) !== 0;
      // Bit 1: Positioning Status (0: Not localized / void, 1: Localized / valid)
      const isValid = (stateFlags & 0x00000002) !== 0;
      // Bit 2: 0: North latitude, 1: South latitude
      const isSouth = (stateFlags & 0x00000004) !== 0;
      // Bit 3: 0: East longitude, 1: West longitude
      const isWest = (stateFlags & 0x00000008) !== 0;

      // Latitude and Longitude (DWORD, in 10^-6 degrees)
      const rawLat = body.readUInt32BE(8);
      const rawLng = body.readUInt32BE(12);

      let latitude = rawLat / 1000000.0;
      let longitude = rawLng / 1000000.0;

      if (isSouth) latitude = -latitude;
      if (isWest) longitude = -longitude;

      // Altitude (WORD, meters)
      // const altitude = body.readUInt16BE(16);

      // Speed (WORD, 1/10 km/h)
      const rawSpeed = body.readUInt16BE(18);
      const speed = Math.round(rawSpeed / 10.0);

      // Direction (WORD, 0-359 degrees)
      const heading = body.readUInt16BE(20) % 360;

      // Time (BCD[6], YY-MM-DD-hh-mm-ss, GMT+8)
      const timeBuf = body.subarray(21, 27);
      const timestamp = parseJt808Timestamp(timeBuf);

      // Parse Additional Information Items (TLV) from offset 28
      let battery: number | undefined = undefined;
      let offset = 28;
      while (offset + 2 <= body.length) {
        const aiId = body[offset];
        const aiLen = body[offset + 1];
        if (offset + 2 + aiLen > body.length) break;

        const aiVal = body.subarray(offset + 2, offset + 2 + aiLen);

        // 0x82: Battery voltage (WORD, 0.1V)
        if (aiId === 0x82 && aiLen >= 2) {
          battery = Math.round((aiVal.readUInt16BE(0) / 10.0) * 10) / 10;
        }

        offset += 2 + aiLen;
      }

      // Check alarms (Table 24):
      // Bit 0: Emergency alarm
      // Bit 1: Over-speed alarm
      // Bit 7: Undervoltage
      // Bit 8: Power failure
      // Bit 15: Low battery
      // Bit 16: Vibration alarm
      const isAlarm = (warningMark & 0x00018183) !== 0;

      // Response ACK (0x8001 Platform Generic Response) is required by JT808 terminals
      const responseAck = buildJt808GenericResponse(
        msgSeq,
        0x0200,
        phoneStr,
        0, // Success
        currentServerSeq
      );

      const packet: ParsedGpsPacket = {
        deviceId: phoneStr,
        latitude,
        longitude,
        speed,
        heading,
        timestamp,
        isValid,
        protocol: "JT808",
        packetType: isAlarm ? "alarm" : "location",
        rawHex: rawPacket.toString("hex"),
        ignition,
        battery,
        responseAck,
      };

      return {
        consumedBytes,
        packet,
        responseAck,
      };
    }

    // 5. GENERIC TERMINAL RESPONSE (0x0001) or other messages
    // Always acknowledge if required
    const responseAck = buildJt808GenericResponse(
      msgSeq,
      msgId,
      phoneStr,
      0,
      currentServerSeq
    );

    return {
      consumedBytes,
      responseAck,
    };
  }
}

export const jt808Parser = new Jt808Parser();
