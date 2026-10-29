import {
  AgentError,
  isRecord,
  normalizeAgentConnection,
  type AgentConnection,
} from "./agent-protocol";

const PREFIX = "LOOI1.";
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** A credential envelope for deliberate paste, never a URL or an auto-open link. */
export function parseAgentSetupCode(input: string): AgentConnection {
  const code = input.trim();
  if (code.length > 4096 || !code.startsWith(PREFIX))
    throw new AgentError("invalid_connection");
  try {
    const encoded = code.slice(PREFIX.length);
    if (!encoded || /[^A-Za-z0-9_-]/u.test(encoded) || encoded.length % 4 === 1)
      throw new Error();
    let bits = 0;
    let count = 0;
    let decoded = "";
    for (const char of encoded) {
      bits = (bits << 6) | ALPHABET.indexOf(char);
      count += 6;
      if (count >= 8) {
        count -= 8;
        const byte = (bits >> count) & 255;
        if (byte > 127) throw new Error();
        decoded += String.fromCharCode(byte);
      }
      bits &= (1 << count) - 1;
    }
    if (bits !== 0) throw new Error();
    const value: unknown = JSON.parse(decoded);
    if (
      !isRecord(value) ||
      Object.keys(value).sort().join(",") !== "token,url" ||
      typeof value.url !== "string" ||
      typeof value.token !== "string"
    )
      throw new Error();
    return normalizeAgentConnection(value.url, value.token);
  } catch {
    throw new AgentError("invalid_connection");
  }
}
