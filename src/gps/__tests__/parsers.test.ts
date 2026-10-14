import {
  convertNmeaToDecimal,
  h02Parser,
  parseH02DateTime,
} from "../parsers/h02";
import {
  gt06Parser,
  calculateGt06Crc,
  buildGt06Ack,
  bcdToDecimalString,
} from "../parsers/gt06";
import { cobanParser } from "../parsers/coban";
import {
  jt808Parser,
  calculateJt808CheckCode,
  unescapeJt808,
  escapeJt808,
  bcdToPhoneString,
  phoneStringToBcd,
  buildJt808GenericResponse,
  buildJt808RegistrationResponse,
} from "../parsers/jt808";
import { autoDetectAndParse, SocketContext } from "../parsers";

function createContext(overrides: Partial<SocketContext> = {}): SocketContext {
  return {
    socketId: "test_sock_1",
    remoteAddress: "127.0.0.1:5023",
    lastPacketAt: new Date(),
    ...overrides,
  };
}

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

function runTests() {
  console.log("==========================================");
  console.log(" RUNNING GPS PROTOCOL PARSER TESTS");
  console.log("==========================================\n");

  let passed = 0;
  let total = 0;

  function test(name: string, fn: () => void) {
    total++;
    try {
      fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`❌ [FAIL] ${name}:`, err.message);
    }
  }

  // 1. NMEA Coordinate Conversion
  test("Coordinate Conversion: DDMM.MMMM North & East", () => {
    // 33 degrees, 41.0640 minutes -> 33 + 41.0640 / 60 = 33.6844
    const lat = convertNmeaToDecimal("3341.0640", "N");
    assert(lat !== null && Math.abs(lat - 33.6844) < 0.0001, `Lat mismatch: ${lat}`);

    // 73 degrees, 02.8740 minutes -> 73 + 2.8740 / 60 = 73.0479
    const lng = convertNmeaToDecimal("07302.8740", "E");
    assert(lng !== null && Math.abs(lng - 73.0479) < 0.0001, `Lng mismatch: ${lng}`);
  });

  test("Coordinate Conversion: South & West Signs", () => {
    const lat = convertNmeaToDecimal("3341.0640", "S");
    assert(lat !== null && lat < 0 && Math.abs(lat - -33.6844) < 0.0001, `Negative lat mismatch: ${lat}`);

    const lng = convertNmeaToDecimal("07302.8740", "W");
    assert(lng !== null && lng < 0 && Math.abs(lng - -73.0479) < 0.0001, `Negative lng mismatch: ${lng}`);
  });

  test("Coordinate Conversion: Invalid or Zero inputs", () => {
    assert(convertNmeaToDecimal("0", "N") === null, "Zero should return null");
    assert(convertNmeaToDecimal("invalid", "N") === null, "Invalid should return null");
  });

  // 2. GT06 CRC and ACK Checksums
  test("GT06 CRC-16 (ITU) Calculation and ACK generation", () => {
    const ack = buildGt06Ack(0x01, 100);
    assert(ack.length === 10, `ACK length should be 10, got ${ack.length}`);
    assert(ack[0] === 0x78 && ack[1] === 0x78, "Start bits should be 0x78 0x78");
    assert(ack[2] === 0x05, "Length should be 0x05");
    assert(ack[3] === 0x01, "Protocol should be 0x01");
    assert(ack.readUInt16BE(4) === 100, "Serial number should be 100");
    assert(ack[8] === 0x0d && ack[9] === 0x0a, "Stop bits should be 0x0D 0x0A");

    // Verify CRC matches
    const crcData = ack.subarray(2, 6);
    const expectedCrc = calculateGt06Crc(crcData);
    assert(ack.readUInt16BE(6) === expectedCrc, "ACK CRC mismatch");
  });

  test("GT06 BCD to Decimal string conversion", () => {
    // IMEI: 868010341870381
    const buf = Buffer.from([0x08, 0x68, 0x01, 0x03, 0x41, 0x87, 0x03, 0x81]);
    const imei = bcdToDecimalString(buf);
    assert(imei === "868010341870381", `IMEI mismatch: ${imei}`);
  });

  // 3. H02 Parser Tests
  test("H02 Parser: Standard V1 location packet", () => {
    const rawPacket = "*HQ,19210086602,V1,123456,A,3341.0640,N,07302.8740,E,025.0,180,091026,FFFFFBFF#";
    const ctx = createContext();
    const result = h02Parser.parse(Buffer.from(rawPacket, "utf8"), ctx);

    assert(result !== null, "H02 result should not be null");
    assert(result!.consumedBytes === rawPacket.length, "Consumed bytes mismatch");
    assert(result!.packet !== undefined, "Packet should exist");

    const p = result!.packet!;
    assert(p.deviceId === "19210086602", `Device ID mismatch: ${p.deviceId}`);
    assert(p.protocol === "H02", "Protocol should be H02");
    assert(p.packetType === "location", "Packet type should be location");
    assert(Math.abs(p.latitude - 33.6844) < 0.0001, `Latitude mismatch: ${p.latitude}`);
    assert(Math.abs(p.longitude - 73.0479) < 0.0001, `Longitude mismatch: ${p.longitude}`);
    assert(p.speed === 46, `Speed in km/h mismatch (25 knots = 46 km/h): ${p.speed}`);
    assert(p.heading === 180, `Heading mismatch: ${p.heading}`);
    assert(p.isValid === true, "Packet should be valid");
  });

  test("H02 Parser: Split / Partial Packet handling", () => {
    const partial = "*HQ,19210086602,V1,123456,A,3341.0640,N";
    const ctx = createContext();
    const result = h02Parser.parse(Buffer.from(partial, "utf8"), ctx);
    assert(result === null, "Partial packet without trailing '#' must return null");
  });

  test("H02 Parser: Concatenated packets in buffer", () => {
    const pkt1 = "*HQ,19210086602,V1,123456,A,3341.0640,N,07302.8740,E,010.0,090,091026,FFFFFBFF#";
    const pkt2 = "*HQ,19210086602,V1,123500,A,3341.1000,N,07302.9000,E,015.0,095,091026,FFFFFBFF#";
    const combined = Buffer.from(pkt1 + pkt2, "utf8");
    const ctx = createContext();

    // Parse first packet
    const res1 = h02Parser.parse(combined, ctx);
    assert(res1 !== null && res1.consumedBytes === pkt1.length, "First packet parse error");
    assert(res1!.packet?.speed === 19, "First packet speed mismatch");

    // Slice buffer and parse second packet
    const remaining = combined.subarray(res1!.consumedBytes);
    const res2 = h02Parser.parse(remaining, ctx);
    assert(res2 !== null && res2.consumedBytes === pkt2.length, "Second packet parse error");
    assert(res2!.packet?.speed === 28, "Second packet speed mismatch");
  });

  // 4. GT06 Parser Tests
  test("GT06 Parser: Login packet (0x01) with ACK generation", () => {
    // 0x78 0x78 (start), 0x0D (length 13), 0x01 (login), 8 bytes IMEI, 0x00 0x05 (serial), 0x12 0x34 (crc), 0x0D 0x0A (stop)
    const imeiBytes = [0x08, 0x68, 0x01, 0x03, 0x41, 0x87, 0x03, 0x81];
    const packet = Buffer.from([
      0x78, 0x78, 0x0d, 0x01,
      ...imeiBytes,
      0x00, 0x05, // serial 5
      0x00, 0x00, // dummy crc
      0x0d, 0x0a, // stop
    ]);

    const ctx = createContext();
    const result = gt06Parser.parse(packet, ctx);
    assert(result !== null, "GT06 login result should not be null");
    assert(result!.consumedBytes === packet.length, "Consumed bytes mismatch");
    assert(result!.packet?.deviceId === "868010341870381", `IMEI mismatch: ${result!.packet?.deviceId}`);
    assert(result!.responseAck !== undefined, "Login ACK must be generated");
    assert(result!.responseAck!.length === 10, "Login ACK must be 10 bytes");
    assert(result!.responseAck![3] === 0x01, "ACK protocol must be 0x01");
  });

  test("GT06 Parser: Location packet (0x12) coordinate and speed decoding", () => {
    const latRaw = Math.round(33.6844 * 1800000); // 60631920
    const lngRaw = Math.round(73.0479 * 1800000); // 131486220
    const latBuf = Buffer.alloc(4);
    latBuf.writeUInt32BE(latRaw);
    const lngBuf = Buffer.alloc(4);
    lngBuf.writeUInt32BE(lngRaw);

    // Course: heading 180 (0x00B4) + status flags: GPS positioned (bit 12: 0x1000) + North (bit 10: 0x0400)
    const courseStatus = 180 | 0x1000 | 0x0400;
    const courseBuf = Buffer.alloc(2);
    courseBuf.writeUInt16BE(courseStatus);

    const payload = [
      0x1a, 0x0a, 0x09, 0x12, 0x1e, 0x00, // 2026-10-09 18:30:00
      0x08, // 8 satellites
      ...latBuf,
      ...lngBuf,
      0x2d, // speed: 45 km/h
      ...courseBuf,
    ];

    const len = 1 + payload.length + 2 + 2; // protocol(1) + payload + serial(2) + crc(2)
    const packet = Buffer.from([
      0x78, 0x78, len, 0x12,
      ...payload,
      0x00, 0x0a, // serial 10
      0x00, 0x00, // crc
      0x0d, 0x0a, // stop
    ]);

    const ctx = createContext({ deviceId: "868010341870381" });
    const result = gt06Parser.parse(packet, ctx);

    assert(result !== null, "Location result should not be null");
    assert(result!.packet !== undefined, "Packet must exist");
    const p = result!.packet!;
    assert(p.deviceId === "868010341870381", "Device ID mismatch");
    assert(Math.abs(p.latitude - 33.6844) < 0.0001, `Lat mismatch: ${p.latitude}`);
    assert(Math.abs(p.longitude - 73.0479) < 0.0001, `Lng mismatch: ${p.longitude}`);
    assert(p.speed === 45, `Speed mismatch: ${p.speed}`);
    assert(p.heading === 180, `Heading mismatch: ${p.heading}`);
    assert(p.isValid === true, "Validity should be true");
  });

  test("GT06 Parser: Split packet (waiting for remainder)", () => {
    const halfPacket = Buffer.from([0x78, 0x78, 0x1f, 0x12, 0x1a, 0x0a]);
    const ctx = createContext();
    const result = gt06Parser.parse(halfPacket, ctx);
    assert(result === null, "Incomplete GT06 packet must return null");
  });

  // 5. Coban Parser Tests
  test("Coban Parser: Handshake and Location packet", () => {
    const handshake = "##,imei:868010341870381,A;\r\n";
    const ctx = createContext();
    const res1 = cobanParser.parse(Buffer.from(handshake, "utf8"), ctx);
    assert(res1 !== null && res1.responseAck !== undefined, "Coban handshake must return LOAD ACK");
    assert(res1!.responseAck!.toString("utf8") === "LOAD\r\n", "ACK mismatch");

    const locPacket = "imei:868010341870381,tracker,2610082155,,F,215500.000,A,3341.0640,N,07302.8740,E,45.2,180;\r\n";
    const res2 = cobanParser.parse(Buffer.from(locPacket, "utf8"), ctx);
    assert(res2 !== null && res2.packet !== undefined, "Coban location must be parsed");
    assert(Math.abs(res2!.packet!.latitude - 33.6844) < 0.0001, `Coban lat mismatch: ${res2!.packet!.latitude}`);
    assert(Math.abs(res2!.packet!.longitude - 73.0479) < 0.0001, `Coban lng mismatch: ${res2!.packet!.longitude}`);
    assert(res2!.packet!.heading === 180, "Coban heading mismatch");
  });

  // 6. JT808 Protocol Tests (PDF Specification)
  test("JT808: Escaping and Unescaping (0x7e <-> 0x7d 0x02, 0x7d <-> 0x7d 0x01)", () => {
    // PDF page 3 example: [0x30, 0x7e, 0x08, 0x7d, 0x55] -> escaped: [0x30, 0x7d, 0x02, 0x08, 0x7d, 0x01, 0x55]
    const raw = Buffer.from([0x30, 0x7e, 0x08, 0x7d, 0x55]);
    const escaped = escapeJt808(raw);
    const expected = Buffer.from([0x30, 0x7d, 0x02, 0x08, 0x7d, 0x01, 0x55]);
    assert(escaped.equals(expected), `Escaped mismatch: ${escaped.toString("hex")}`);

    const unescaped = unescapeJt808(escaped);
    assert(unescaped.equals(raw), `Unescaped mismatch: ${unescaped.toString("hex")}`);
  });

  test("JT808: BCD Phone Number Conversion", () => {
    const bcd = Buffer.from([0x01, 0x91, 0x75, 0x64, 0x59, 0x28]);
    const phone = bcdToPhoneString(bcd);
    assert(phone === "019175645928", `Phone mismatch: ${phone}`);

    const convertedBcd = phoneStringToBcd("019175645928");
    assert(convertedBcd.equals(bcd), "Phone to BCD mismatch");
  });

  test("JT808 Parser: Location Information Report (0x0200) from PDF page 11", () => {
    // Exact hex packet from PDF Page 11:
    const hex =
      "7e02000042019175645928000200000000000000020158dfa206c9607800310000000026032115553501040000068a30011a31011c82020077cc143839383630344136313032353730303333343730dc7e";
    const buf = Buffer.from(hex, "hex");
    const ctx = createContext();

    const result = jt808Parser.parse(buf, ctx);
    assert(result !== null, "JT808 parse result should not be null");
    assert(result!.consumedBytes === buf.length, `Consumed bytes mismatch: ${result!.consumedBytes} vs ${buf.length}`);
    assert(result!.packet !== undefined, "Packet must be parsed");

    const p = result!.packet!;
    assert(p.deviceId === "019175645928", `Device ID mismatch: ${p.deviceId}`);
    assert(p.protocol === "JT808", `Protocol mismatch: ${p.protocol}`);
    assert(p.packetType === "location", `Packet type mismatch: ${p.packetType}`);
    assert(Math.abs(p.latitude - 22.601634) < 0.00001, `Lat mismatch: ${p.latitude}`);
    assert(Math.abs(p.longitude - 113.860728) < 0.00001, `Lng mismatch: ${p.longitude}`);
    assert(p.speed === 0, `Speed mismatch: ${p.speed}`);
    assert(p.heading === 0, `Heading mismatch: ${p.heading}`);
    assert(p.isValid === true, `Validity mismatch: ${p.isValid}`);
    assert(p.battery === 11.9, `Battery voltage mismatch: ${p.battery}`);

    // Verify Platform Generic Response ACK (0x8001) was generated
    assert(result!.responseAck !== undefined, "responseAck must be present");
    const ack = result!.responseAck!;
    assert(ack[0] === 0x7e && ack[ack.length - 1] === 0x7e, "ACK must have 0x7E framing");
    const unescapedAck = unescapeJt808(ack.subarray(1, ack.length - 1));
    assert(unescapedAck.readUInt16BE(0) === 0x8001, "ACK must be 0x8001");
    // Reply seq must be 0x0002 (matching terminal msg seq)
    assert(unescapedAck.readUInt16BE(12) === 0x0002, "ACK reply seq mismatch");
    // Reply ID must be 0x0200 (location)
    assert(unescapedAck.readUInt16BE(14) === 0x0200, "ACK reply ID mismatch");
    // Result must be 0 (success)
    assert(unescapedAck[16] === 0, "ACK result must be 0");
  });

  test("JT808 Parser: Terminal Registration (0x0100) from PDF page 7", () => {
    // Exact hex from PDF Page 7
    const hex =
      "7e0100002d019175645928000a0022044e373034343456335f4f50454e5f4a54383038000000000000003536343539323802d4c14235373139318d7e";
    const buf = Buffer.from(hex, "hex");
    const ctx = createContext();

    const result = jt808Parser.parse(buf, ctx);
    assert(result !== null, "JT808 registration result should not be null");
    assert(result!.packet?.packetType === "login", "Packet type must be login");
    assert(result!.packet?.deviceId === "019175645928", "Device ID mismatch");

    // Verify Registration Response (0x8100)
    assert(result!.responseAck !== undefined, "Registration ACK must be returned");
    const ack = result!.responseAck!;
    const unescapedAck = unescapeJt808(ack.subarray(1, ack.length - 1));
    assert(unescapedAck.readUInt16BE(0) === 0x8100, "ACK must be 0x8100");
    assert(unescapedAck.readUInt16BE(12) === 0x000a, "ACK reply seq must be 0x000A");
    assert(unescapedAck[14] === 0, "ACK result must be 0 (Success)");
  });

  test("JT808 Parser: Terminal Authentication (0x0102) from PDF page 8", () => {
    const hex = "7e01020006019175645928000b0191756459280e7e";
    const buf = Buffer.from(hex, "hex");
    const ctx = createContext();

    const result = jt808Parser.parse(buf, ctx);
    assert(result !== null, "Authentication result should not be null");
    assert(result!.packet?.packetType === "login", "Packet type must be login");
    assert(result!.responseAck !== undefined, "ACK must be returned");
    const ack = result!.responseAck!;
    const unescapedAck = unescapeJt808(ack.subarray(1, ack.length - 1));
    assert(unescapedAck.readUInt16BE(0) === 0x8001, "ACK must be 0x8001");
    assert(unescapedAck.readUInt16BE(12) === 0x000b, "Reply seq must be 0x000B");
    assert(unescapedAck.readUInt16BE(14) === 0x0102, "Reply ID must be 0x0102");
  });

  test("JT808 Parser: Heartbeat (0x0002) from PDF page 6", () => {
    const hex = "7e00020000019175645928000bf97e";
    const buf = Buffer.from(hex, "hex");
    const ctx = createContext();

    const result = jt808Parser.parse(buf, ctx);
    assert(result !== null, "Heartbeat result should not be null");
    assert(result!.packet?.packetType === "heartbeat", "Packet type must be heartbeat");
    assert(result!.responseAck !== undefined, "Heartbeat ACK must be returned");
  });

  // 7. Auto-Detection Dispatcher
  test("Auto-Detection: Correctly dispatches JT808 vs H02 vs GT06 vs Coban", () => {
    const ctx0 = createContext();
    const jt808Buf = Buffer.from("7e00020000019175645928000bf97e", "hex");
    const jt808Res = autoDetectAndParse(jt808Buf, ctx0);
    assert(jt808Res !== null && ctx0.detectedProtocol === "JT808", "Auto-detect JT808 failed");

    const ctx = createContext();
    const h02Buf = Buffer.from("*HQ,19210086602,V1,123456,A,3341.0640,N,07302.8740,E,000.0,000,091026,FFFFFBFF#");
    const h02Res = autoDetectAndParse(h02Buf, ctx);
    assert(h02Res !== null && h02Res.packet?.protocol === "H02", "Auto-detect H02 failed");

    const ctx2 = createContext();
    const gt06Buf = Buffer.from([0x78, 0x78, 0x05, 0x01, 0x00, 0x01, 0x12, 0x34, 0x0d, 0x0a]);
    const gt06Res = autoDetectAndParse(gt06Buf, ctx2);
    assert(gt06Res !== null && ctx2.detectedProtocol === "GT06", "Auto-detect GT06 failed");

    const ctx3 = createContext();
    const cobanBuf = Buffer.from("##,imei:868010341870381,A;\r\n");
    const cobanRes = autoDetectAndParse(cobanBuf, ctx3);
    assert(cobanRes !== null && ctx3.detectedProtocol === "COBAN", "Auto-detect Coban failed");
  });

  console.log(`\n==========================================`);
  console.log(` RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log(`==========================================`);

  if (passed !== total) {
    process.exit(1);
  }
}

runTests();
