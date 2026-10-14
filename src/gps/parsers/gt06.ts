import { ProtocolParser, ParseResult, SocketContext, ParsedGpsPacket } from "./types";

/**
 * Standard GT06 CRC-16 (CRC-ITU) lookup table
 */
export const GT06_CRC16_TABLE = new Uint16Array([
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

export function calculateGt06Crc(data: Buffer | Uint8Array): number {
  let crc = 0x0000;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    crc = ((crc << 8) & 0xffff) ^ GT06_CRC16_TABLE[((crc >> 8) ^ byte) & 0xff];
  }
  return crc & 0xffff;
}

/**
 * Builds a 10-byte standard GT06 ACK packet:
 * 0x78 0x78 0x05 [Protocol] [SerialH] [SerialL] [CRCH] [CRCL] 0x0D 0x0A
 */
export function buildGt06Ack(protocol: number, serialNumber: number): Buffer {
  const ack = Buffer.alloc(10);
  ack[0] = 0x78;
  ack[1] = 0x78;
  ack[2] = 0x05; // Length of: protocol(1) + serial(2) + crc(2) = 5
  ack[3] = protocol;
  ack.writeUInt16BE(serialNumber, 4);

  // CRC is calculated over length, protocol, and serial
  const crcData = ack.subarray(2, 6);
  const crc = calculateGt06Crc(crcData);
  ack.writeUInt16BE(crc, 6);

  ack[8] = 0x0d;
  ack[9] = 0x0a;
  return ack;
}

/**
 * Converts 8-byte BCD buffer into IMEI string
 */
export function bcdToDecimalString(buf: Buffer): string {
  let result = "";
  for (let i = 0; i < buf.length; i++) {
    const high = (buf[i] >> 4) & 0x0f;
    const low = buf[i] & 0x0f;
    result += high.toString(10) + low.toString(10);
  }
  // If 16 digits and starts with 0, strip leading 0 for 15-digit IMEI
  if (result.length === 16 && result.startsWith("0")) {
    return result.slice(1);
  }
  return result;
}

/**
 * GT06 Binary Protocol Parser
 * Supports Concox / GT06 / TR06 trackers (0x78 0x78 or 0x79 0x79)
 */
export class Gt06Parser implements ProtocolParser {
  name = "GT06";

  canParse(buf: Buffer): boolean {
    if (buf.length < 2) return false;
    const isStandard = buf[0] === 0x78 && buf[1] === 0x78;
    const isExtended = buf[0] === 0x79 && buf[1] === 0x79;
    return isStandard || isExtended;
  }

  parse(buf: Buffer, context: SocketContext): ParseResult | null {
    if (buf.length < 5) return null;

    const isStandard = buf[0] === 0x78 && buf[1] === 0x78;
    let lengthOffset = 2;
    let length = 0;
    let headerSize = 0;

    if (isStandard) {
      length = buf[lengthOffset];
      headerSize = 3; // 2 start bits + 1 length byte
    } else {
      // Extended packet (0x79 0x79)
      length = buf.readUInt16BE(lengthOffset);
      headerSize = 4; // 2 start bits + 2 length bytes
    }

    // Full packet size = headerSize + length + 2 (stop bits 0x0D 0x0A)
    const expectedPacketSize = headerSize + length + 2;
    if (buf.length < expectedPacketSize) {
      // Incomplete packet; wait for next chunk
      return null;
    }

    const packetBuf = buf.subarray(0, expectedPacketSize);
    const consumedBytes = expectedPacketSize;

    // Check stop bits (0x0D 0x0A)
    if (packetBuf[expectedPacketSize - 2] !== 0x0d || packetBuf[expectedPacketSize - 1] !== 0x0a) {
      // Corrupted packet boundaries, skip 1 byte to re-align
      return { consumedBytes: 1 };
    }

    const protocol = packetBuf[headerSize];
    const serialOffset = expectedPacketSize - 6;
    const serialNumber = packetBuf.readUInt16BE(serialOffset);

    // 1. LOGIN PACKET (0x01)
    if (protocol === 0x01) {
      const imeiBuf = packetBuf.subarray(headerSize + 1, headerSize + 9);
      const deviceId = bcdToDecimalString(imeiBuf);
      if (deviceId) {
        context.deviceId = deviceId;
      }

      // Generate Login ACK
      const responseAck = buildGt06Ack(0x01, serialNumber);

      const packet: ParsedGpsPacket = {
        deviceId: deviceId || context.deviceId || "UNKNOWN",
        latitude: 0,
        longitude: 0,
        speed: 0,
        heading: 0,
        timestamp: new Date(),
        isValid: false,
        protocol: "GT06",
        packetType: "login",
        rawHex: packetBuf.toString("hex"),
        responseAck,
      };

      return {
        consumedBytes,
        packet,
        responseAck,
      };
    }

    // 2. HEARTBEAT / STATUS PACKET (0x13 or 0x23)
    if (protocol === 0x13 || protocol === 0x23) {
      const responseAck = buildGt06Ack(protocol, serialNumber);

      let ignition: boolean | undefined = undefined;
      let battery: number | undefined = undefined;

      const payloadOffset = headerSize + 1;
      if (payloadOffset < expectedPacketSize - 6) {
        const terminalInfo = packetBuf[payloadOffset];
        // Bit 1: ACC (0: low/off, 1: high/on)
        ignition = (terminalInfo & 0x02) !== 0;
        // Voltage level (0-6)
        if (payloadOffset + 1 < expectedPacketSize - 6) {
          battery = Math.round((packetBuf[payloadOffset + 1] / 6) * 100);
        }
      }

      const packet: ParsedGpsPacket = {
        deviceId: context.deviceId || "UNKNOWN",
        latitude: 0,
        longitude: 0,
        speed: 0,
        heading: 0,
        timestamp: new Date(),
        isValid: false,
        protocol: "GT06",
        packetType: "heartbeat",
        rawHex: packetBuf.toString("hex"),
        responseAck,
        ignition,
        battery,
      };

      return {
        consumedBytes,
        packet,
        responseAck,
      };
    }

    // 3. LOCATION PACKET (0x12 or 0x22) or ALARM (0x16)
    if (protocol === 0x12 || protocol === 0x22 || protocol === 0x16) {
      let responseAck: Buffer | undefined = undefined;
      if (protocol === 0x16) {
        // Alarms require ACK response
        responseAck = buildGt06Ack(0x16, serialNumber);
      }

      const pos = headerSize + 1;
      // Date and Time (6 bytes: YY MM DD HH MM SS)
      const year = 2000 + packetBuf[pos];
      const month = packetBuf[pos + 1] - 1; // 0-based
      const day = packetBuf[pos + 2];
      const hour = packetBuf[pos + 3];
      const minute = packetBuf[pos + 4];
      const second = packetBuf[pos + 5];

      const timestamp = new Date(Date.UTC(year, month, day, hour, minute, second));

      // GPS Info length / Satellites (1 byte)
      // Latitude (4 bytes uint32 BE)
      const rawLat = packetBuf.readUInt32BE(pos + 7);
      // Longitude (4 bytes uint32 BE)
      const rawLng = packetBuf.readUInt32BE(pos + 11);

      // Speed (1 byte in km/h)
      const speed = packetBuf[pos + 15];

      // Course and Status (2 bytes uint16 BE)
      const courseStatus = packetBuf.readUInt16BE(pos + 16);
      const heading = courseStatus & 0x03ff; // bits 0-9 (0-360)

      // Bit 12: 0=East, 1=West
      const isWest = (courseStatus & 0x0800) !== 0;
      // Bit 13: 0=South, 1=North
      const isSouth = (courseStatus & 0x0400) === 0;
      // Bit 11: 1=GPS positioned, 0=not positioned
      const isValid = (courseStatus & 0x1000) !== 0;

      let latitude = rawLat / 1800000.0;
      let longitude = rawLng / 1800000.0;

      if (isSouth) latitude = -latitude;
      if (isWest) longitude = -longitude;

      const packet: ParsedGpsPacket = {
        deviceId: context.deviceId || "UNKNOWN",
        latitude,
        longitude,
        speed,
        heading,
        timestamp,
        isValid,
        protocol: "GT06",
        packetType: protocol === 0x16 ? "alarm" : "location",
        rawHex: packetBuf.toString("hex"),
        responseAck,
      };

      return {
        consumedBytes,
        packet,
        responseAck,
      };
    }

    // Other packets (e.g., LBS 0x28, General Info): consume without error
    return { consumedBytes };
  }
}

export const gt06Parser = new Gt06Parser();
