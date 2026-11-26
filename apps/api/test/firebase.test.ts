import { SignJWT, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { verifyFirebaseTokenWithCerts } from "../src/auth/firebase.js";

function encodeLength(len: number): Uint8Array {
  if (len < 0x80) return new Uint8Array([len]);
  const bytes: number[] = [];
  let temp = len;
  while (temp > 0) {
    bytes.unshift(temp & 0xff);
    temp >>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function derTag(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const lenBytes = encodeLength(total);
  const out = new Uint8Array(1 + lenBytes.length + total);
  out[0] = tag;
  out.set(lenBytes, 1);
  let offset = 1 + lenBytes.length;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function createSelfSignedX509Pem() {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", publicKey));

  const version = derTag(0xa0, derTag(0x02, new Uint8Array([2])));
  const serial = derTag(0x02, new Uint8Array([1]));
  const sha256WithRsa = derTag(
    0x30,
    new Uint8Array([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]),
    new Uint8Array([0x05, 0x00])
  );
  const cn = derTag(
    0x30,
    derTag(
      0x31,
      derTag(
        0x30,
        new Uint8Array([0x06, 0x03, 0x55, 0x04, 0x03]),
        derTag(0x13, new TextEncoder().encode("test-firebase-cert"))
      )
    )
  );
  const validity = derTag(
    0x30,
    derTag(0x17, new TextEncoder().encode("250101000000Z")),
    derTag(0x17, new TextEncoder().encode("350101000000Z"))
  );
  const tbs = derTag(0x30, version, serial, sha256WithRsa, cn, validity, cn, spki);
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, tbs)
  );
  const bitString = derTag(0x03, new Uint8Array([0]), sig);
  const certDer = derTag(0x30, tbs, sha256WithRsa, bitString);

  let binary = "";
  for (let i = 0; i < certDer.length; i += 1) {
    binary += String.fromCharCode(certDer[i]!);
  }
  const b64 = btoa(binary).match(/.{1,64}/g)?.join("\n") ?? "";
  return {
    privateKey,
    pem: `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----`
  };
}

describe("Firebase ID token verification", () => {
  it("accepts a valid token and rejects expired, wrong-audience, and wrong-issuer tokens", async () => {
    const { privateKey, pem } = await createSelfSignedX509Pem();
    const kid = "test-kid-1";
    const projectId = "redressa-test";
    const certs = { [kid]: pem };

    const validJwt = await new SignJWT({
      email: "citizen@example.com",
      name: "Test Citizen",
      firebase: { sign_in_provider: "google.com" }
    })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(`https://securetoken.google.com/${projectId}`)
      .setAudience(projectId)
      .setSubject("uid-123")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    const verified = await verifyFirebaseTokenWithCerts(validJwt, projectId, certs);
    expect(verified.uid).toBe("uid-123");
    expect(verified.isAnonymous).toBe(false);

    const wrongAudJwt = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(`https://securetoken.google.com/${projectId}`)
      .setAudience("other-project")
      .setSubject("uid-123")
      .setExpirationTime("1h")
      .sign(privateKey);

    await expect(verifyFirebaseTokenWithCerts(wrongAudJwt, projectId, certs)).rejects.toThrow();

    const wrongIssJwt = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer("https://evil.example.com")
      .setAudience(projectId)
      .setSubject("uid-123")
      .setExpirationTime("1h")
      .sign(privateKey);

    await expect(verifyFirebaseTokenWithCerts(wrongIssJwt, projectId, certs)).rejects.toThrow();

    const expiredJwt = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(`https://securetoken.google.com/${projectId}`)
      .setAudience(projectId)
      .setSubject("uid-123")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 300)
      .sign(privateKey);

    await expect(verifyFirebaseTokenWithCerts(expiredJwt, projectId, certs)).rejects.toThrow();
  });
});
