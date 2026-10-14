export interface ParsedGpsPacket {
  deviceId: string;
  latitude: number;
  longitude: number;
  speed: number; // km/h
  heading: number; // degrees 0-360
  timestamp: Date;
  isValid: boolean;
  protocol: string;
  packetType: "location" | "login" | "heartbeat" | "alarm" | "other";
  rawAscii?: string;
  rawHex?: string;
  battery?: number; // voltage or %
  ignition?: boolean; // ACC state
  responseAck?: Buffer;
}

export interface SocketContext {
  socketId: string;
  remoteAddress: string;
  deviceId?: string;
  detectedProtocol?: string;
  lastPacketAt: Date;
}

export interface ParseResult {
  consumedBytes: number;
  packet?: ParsedGpsPacket;
  responseAck?: Buffer;
}

export interface ProtocolParser {
  name: string;
  canParse(buf: Buffer): boolean;
  parse(buf: Buffer, context: SocketContext): ParseResult | null;
}
