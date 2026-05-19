import crypto from "node:crypto";

const AES_128_HEX_RE = /^[0-9a-f]{32}$/;

export function createIlinkMediaAesKey() {
  const rawKey = crypto.randomBytes(16);
  return {
    rawKey,
    aesKeyHex: rawKey.toString("hex"),
  };
}

export function normalizeIlinkMediaAesKeyHex(aesKeyHex) {
  if (typeof aesKeyHex !== "string") {
    throw new Error("WeChat iLink media aes key must be a hex string");
  }
  const normalized = aesKeyHex.toLowerCase();
  if (!AES_128_HEX_RE.test(normalized)) {
    throw new Error("WeChat iLink media aes key must be 32 hex characters");
  }
  return normalized;
}

export function encodeIlinkMediaAesKey(aesKeyHex) {
  return Buffer.from(normalizeIlinkMediaAesKeyHex(aesKeyHex), "ascii").toString("base64");
}

export function decodeIlinkMediaAesKey(aesKeyBase64) {
  const decoded = Buffer.from(aesKeyBase64, "base64");
  if (decoded.length === 16) return Buffer.from(decoded);
  if (decoded.length === 32) {
    const aesKeyHex = normalizeIlinkMediaAesKeyHex(decoded.toString("ascii"));
    return Buffer.from(aesKeyHex, "hex");
  }
  throw new Error(`invalid WeChat iLink media aes_key length: ${decoded.length}`);
}
