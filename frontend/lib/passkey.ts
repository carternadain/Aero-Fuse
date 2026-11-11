"use client";

// Browser half of passkey sign-in (Face ID / Touch ID / a security key). The server half is
// backend/passkeys.py. Binary fields travel as base64url, converted here by hand because
// older Safari lacks the built-in JSON helpers.

const enc = (b: ArrayBuffer | null | undefined): string => {
  if (!b) return "";
  let s = "";
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const dec = (s: string): ArrayBuffer => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

export const passkeysSupported = () =>
  typeof window !== "undefined" && window.isSecureContext && typeof window.PublicKeyCredential !== "undefined";

/** "Face ID", "Touch ID" or a neutral name, for button labels. */
export function passkeyName(): string {
  if (typeof navigator === "undefined") return "a passkey";
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "Face ID";
  if (/Macintosh/.test(ua)) return "Touch ID";
  return "a passkey";
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { detail?: string }).detail || "Something went wrong");
  return data as T;
}

type Desc = { id: string; type: "public-key"; transports?: AuthenticatorTransport[] };
const descs = (list?: Desc[]) => (list ?? []).map((d) => ({ ...d, id: dec(d.id) }));

/** True when the person closed the system sheet, which isn't an error worth showing. */
export const wasCancelled = (e: unknown) => e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError");

export async function signInWithPasskey(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const o = await post<any>("/api/auth/passkey/login/options");
  const cred = (await navigator.credentials.get({
    publicKey: { ...o, challenge: dec(o.challenge), allowCredentials: descs(o.allowCredentials) },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No passkey was chosen");
  const r = cred.response as AuthenticatorAssertionResponse;
  await post("/api/auth/passkey/login/verify", {
    credential: {
      id: cred.id, rawId: enc(cred.rawId), type: cred.type,
      response: {
        clientDataJSON: enc(r.clientDataJSON), authenticatorData: enc(r.authenticatorData),
        signature: enc(r.signature), userHandle: r.userHandle ? enc(r.userHandle) : null,
      },
    },
  });
}

export interface PasskeyRow { id: number; name: string; site: string; created_at: string; last_used_at: string | null }

export async function addPasskey(name: string): Promise<PasskeyRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const o = await post<any>("/api/auth/passkey/register/options");
  const cred = (await navigator.credentials.create({
    publicKey: { ...o, challenge: dec(o.challenge), user: { ...o.user, id: dec(o.user.id) }, excludeCredentials: descs(o.excludeCredentials) },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No passkey was made");
  const r = cred.response as AuthenticatorAttestationResponse;
  const out = await post<{ passkeys: PasskeyRow[] }>("/api/auth/passkey/register/verify", {
    name,
    credential: {
      id: cred.id, rawId: enc(cred.rawId), type: cred.type,
      response: { clientDataJSON: enc(r.clientDataJSON), attestationObject: enc(r.attestationObject) },
    },
  });
  return out.passkeys;
}
