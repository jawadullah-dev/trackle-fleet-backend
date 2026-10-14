import { ProtocolParser, ParseResult, SocketContext } from "./types";
import { gt06Parser } from "./gt06";
import { h02Parser } from "./h02";
import { cobanParser } from "./coban";
import { jt808Parser } from "./jt808";

export * from "./types";
export * from "./gt06";
export * from "./h02";
export * from "./coban";
export * from "./jt808";

// Registered pluggable parsers list
export const registeredParsers: ProtocolParser[] = [
  jt808Parser,
  gt06Parser,
  h02Parser,
  cobanParser,
];

/**
 * Registers a new custom protocol parser
 */
export function registerParser(parser: ProtocolParser): void {
  // Add to beginning so custom parsers take precedence
  registeredParsers.unshift(parser);
}

/**
 * Auto-detects protocol parser based on buffer contents and parses the packet.
 */
export function autoDetectAndParse(
  buffer: Buffer,
  context: SocketContext
): ParseResult | null {
  if (buffer.length === 0) return null;

  // 1. If we already detected a protocol for this socket, try it first
  if (context.detectedProtocol) {
    const knownParser = registeredParsers.find(
      (p) => p.name === context.detectedProtocol
    );
    if (knownParser && knownParser.canParse(buffer)) {
      const result = knownParser.parse(buffer, context);
      if (result) return result;
    }
  }

  // 2. Iterate through registered parsers to find matching one
  for (const parser of registeredParsers) {
    if (parser.canParse(buffer)) {
      context.detectedProtocol = parser.name;
      const result = parser.parse(buffer, context);
      return result;
    }
  }

  // 3. If unrecognized starting byte, advance 1 byte to re-synchronize stream
  // (Prevents socket buffer deadlocks on unexpected noise bytes)
  return { consumedBytes: 1 };
}
