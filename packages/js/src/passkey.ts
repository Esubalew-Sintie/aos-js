import { fromBase64url, toBase64url } from "./base64url.js";

// The engine returns the options the go-webauthn library makes:
// {publicKey: {...}} with base64url strings where the browser wants buffers.

/* eslint-disable @typescript-eslint/no-explicit-any */
export function creationOptions(options: any): CredentialCreationOptions {
  const pk = { ...options.publicKey };
  pk.challenge = fromBase64url(pk.challenge);
  pk.user = { ...pk.user, id: fromBase64url(pk.user.id) };
  if (pk.excludeCredentials) pk.excludeCredentials = pk.excludeCredentials.map((c: any) => ({ ...c, id: fromBase64url(c.id) }));
  return { publicKey: pk };
}

export function requestOptions(options: any): CredentialRequestOptions {
  const pk = { ...options.publicKey };
  pk.challenge = fromBase64url(pk.challenge);
  if (pk.allowCredentials) pk.allowCredentials = pk.allowCredentials.map((c: any) => ({ ...c, id: fromBase64url(c.id) }));
  return { publicKey: pk, mediation: options.mediation };
}

export function serializeCredential(cred: PublicKeyCredential): Record<string, unknown> {
  const r: any = cred.response;
  const response: Record<string, unknown> = { clientDataJSON: toBase64url(r.clientDataJSON) };
  if (r.attestationObject) {
    response.attestationObject = toBase64url(r.attestationObject);
    if (typeof r.getTransports === "function") response.transports = r.getTransports();
  }
  if (r.authenticatorData) response.authenticatorData = toBase64url(r.authenticatorData);
  if (r.signature) response.signature = toBase64url(r.signature);
  if (r.userHandle) response.userHandle = toBase64url(r.userHandle);
  return {
    id: cred.id,
    rawId: toBase64url(cred.rawId),
    type: cred.type,
    response,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    authenticatorAttachment: (cred as any).authenticatorAttachment ?? undefined,
  };
}
