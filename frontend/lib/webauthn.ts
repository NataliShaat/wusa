// WebAuthn - client-side trigger only, NOT verified server-side. This is a
// deliberate demo simplification: it pops the real OS biometric prompt
// (Face ID / Windows Hello / fingerprint, whatever the device has) so it
// looks and behaves identically to a production flow, but the backend
// never checks the resulting signature - it trusts the browser's
// success/failure result. This is a stand-in for real bank device
// enrollment, not production security.

import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

const RP_NAME = "بنك تجريبي";
const CREDENTIAL_ID_KEY = "wusa_webauthn_credential_id";

function rpId(): string {
  return window.location.hostname;
}

function randomBase64Url(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function hasEnrolledCredential(): boolean {
  return typeof window !== "undefined" && !!localStorage.getItem(CREDENTIAL_ID_KEY);
}

export async function enroll(): Promise<boolean> {
  const options: PublicKeyCredentialCreationOptionsJSON = {
    rp: { name: RP_NAME, id: rpId() },
    user: {
      id: randomBase64Url(16),
      name: "demo-user",
      displayName: "مستخدم تجريبي",
    },
    challenge: randomBase64Url(32),
    pubKeyCredParams: [
      { alg: -7, type: "public-key" }, // ES256
      { alg: -257, type: "public-key" }, // RS256
    ],
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      userVerification: "required",
    },
    timeout: 60000,
    attestation: "none",
  };

  try {
    const credential = await startRegistration({ optionsJSON: options });
    localStorage.setItem(CREDENTIAL_ID_KEY, credential.id);
    return true;
  } catch {
    return false;
  }
}

export async function confirmWithBiometrics(): Promise<boolean> {
  const credentialId = localStorage.getItem(CREDENTIAL_ID_KEY);
  if (!credentialId) return false;

  const options: PublicKeyCredentialRequestOptionsJSON = {
    challenge: randomBase64Url(32),
    rpId: rpId(),
    allowCredentials: [{ id: credentialId, type: "public-key" }],
    userVerification: "required",
    timeout: 60000,
  };

  try {
    await startAuthentication({ optionsJSON: options });
    return true;
  } catch {
    return false;
  }
}
