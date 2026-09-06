import crypto from "node:crypto";

const SIGNATURE_PREFIX = "sha256=";


export function verifySignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const expectedHex = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const expected = Buffer.from(SIGNATURE_PREFIX + expectedHex, "utf8");
  const actual = Buffer.from(signatureHeader, "utf8");

  if (expected.length !== actual.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, actual);
}
