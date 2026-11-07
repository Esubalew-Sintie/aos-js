import { createHmac, timingSafeEqual } from "node:crypto";
import { BadSignatureError } from "./errors.js";
import type { WebhookEvent } from "./types.js";

/**
 * Checks the X-AOS-Signature header ("t=<unix>,v1=<hex>") of a delivery
 * and returns the event. Pass the raw body, exactly as received.
 * Deliveries older than toleranceSeconds (default 300) are refused.
 */
export function verifyWebhook<T = unknown>(
  secret: string,
  header: string | null | undefined,
  rawBody: string | Buffer | Uint8Array,
  toleranceSeconds = 300,
  nowMs: number = Date.now(),
): WebhookEvent<T> {
  let ts = "";
  const sigs: string[] = [];
  for (const part of (header ?? "").split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t") ts = v ?? "";
    else if (k === "v1" && v) sigs.push(v);
  }
  const unix = Number(ts);
  if (!ts || !Number.isInteger(unix) || sigs.length === 0) throw new BadSignatureError();
  if (Math.abs(nowMs / 1000 - unix) > toleranceSeconds) throw new BadSignatureError();
  const body = typeof rawBody === "string" ? Buffer.from(rawBody) : Buffer.from(rawBody);
  const want = createHmac("sha256", secret).update(ts).update(".").update(body).digest();
  const ok = sigs.some((s) => {
    const got = Buffer.from(s, "hex");
    return got.length === want.length && timingSafeEqual(got, want);
  });
  if (!ok) throw new BadSignatureError();
  return JSON.parse(body.toString("utf8")) as WebhookEvent<T>;
}

/** Makes a signature header, for tests of your own webhook handler. */
export function signWebhook(secret: string, rawBody: string, nowMs: number = Date.now()): string {
  const ts = Math.floor(nowMs / 1000).toString();
  return `t=${ts},v1=${createHmac("sha256", secret).update(ts).update(".").update(rawBody).digest("hex")}`;
}
