// QuickPay Payment Integration
// API docs: https://learn.quickpay.net/tech-talk/
// Uses QuickPay Link flow: Create payment → Create link → Customer pays → Callback

import crypto from "crypto";
import { prisma } from "./prisma";

const BASE_URL = "https://api.quickpay.net";

async function getQuickPayConfig() {
  const settings = await prisma.globalSetting.findMany();
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  return {
    apiKey: map.quickpay_api_key || "",
    privateKey: map.quickpay_private_key || "",
    enabled: map.quickpay_enabled === "true",
  };
}

async function quickPayRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const config = await getQuickPayConfig();
  if (!config.apiKey) throw new Error("QuickPay API-nøgle er ikke konfigureret");

  const headers: Record<string, string> = {
    "Accept-Version": "v10",
    Authorization: `Basic ${Buffer.from(`:${config.apiKey}`).toString("base64")}`,
    "Content-Type": "application/json",
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`QuickPay ${method} ${path}: ${res.status} ${res.statusText} — ${text}`);
  }

  return res.json();
}

// ──────────────────────────────────────────────
// Create a payment and get a payment link
// ──────────────────────────────────────────────
export async function createPaymentLink(params: {
  orderId: string;       // Unique order ID (4–20 chars, alphanumeric)
  amount: number;        // Amount in DKK (will be converted to øre)
  currency?: string;     // Default: DKK
  continueUrl: string;   // Redirect URL after successful payment
  cancelUrl: string;     // Redirect URL on cancel
  callbackUrl: string;   // Server callback URL for payment confirmation
}): Promise<{ paymentId: number; paymentLink: string }> {
  // Step 1: Create the payment
  const payment = await quickPayRequest("POST", "/payments", {
    order_id: params.orderId,
    currency: params.currency || "DKK",
  });

  const paymentId = payment.id as number;

  // Step 2: Create a payment link
  const amountInOere = Math.round(params.amount * 100);

  const linkResponse = await quickPayRequest("PUT", `/payments/${paymentId}/link`, {
    amount: amountInOere,
    continue_url: params.continueUrl,
    cancel_url: params.cancelUrl,
    callback_url: params.callbackUrl,
    auto_capture: true,
  });

  const paymentLink = linkResponse.url as string;

  return { paymentId, paymentLink };
}

// ──────────────────────────────────────────────
// Create a payment with pre-authorization (no auto-capture)
// Used for metered billing where the final amount is unknown
// ──────────────────────────────────────────────
export async function createAuthPaymentLink(params: {
  orderId: string;
  amount: number;        // Max reservation amount in DKK
  currency?: string;
  continueUrl: string;
  cancelUrl: string;
  callbackUrl: string;
}): Promise<{ paymentId: number; paymentLink: string }> {
  const payment = await quickPayRequest("POST", "/payments", {
    order_id: params.orderId,
    currency: params.currency || "DKK",
  });

  const paymentId = payment.id as number;
  const amountInOere = Math.round(params.amount * 100);

  const linkResponse = await quickPayRequest("PUT", `/payments/${paymentId}/link`, {
    amount: amountInOere,
    continue_url: params.continueUrl,
    cancel_url: params.cancelUrl,
    callback_url: params.callbackUrl,
    auto_capture: false,
  });

  const paymentLink = linkResponse.url as string;
  return { paymentId, paymentLink };
}

// ──────────────────────────────────────────────
// Capture an authorized payment (partial or full)
// ──────────────────────────────────────────────
export async function capturePayment(paymentId: string, amountDKK: number): Promise<void> {
  const amountInOere = Math.round(amountDKK * 100);
  await quickPayRequest("POST", `/payments/${paymentId}/capture`, {
    amount: amountInOere,
  });
}

// ──────────────────────────────────────────────
// Cancel/void an authorized payment (release held funds)
// ──────────────────────────────────────────────
export async function cancelPayment(paymentId: string): Promise<void> {
  await quickPayRequest("POST", `/payments/${paymentId}/cancel`);
}

// ──────────────────────────────────────────────
// Verify QuickPay callback checksum
// ──────────────────────────────────────────────
export async function verifyCallbackChecksum(rawBody: string, checksum: string): Promise<boolean> {
  const config = await getQuickPayConfig();
  if (!config.privateKey) return false;

  const computed = crypto
    .createHmac("sha256", config.privateKey)
    .update(rawBody)
    .digest("hex");

  return computed === checksum;
}

// ──────────────────────────────────────────────
// Check if payment was accepted
// ──────────────────────────────────────────────
export function isPaymentAccepted(callbackBody: Record<string, unknown>): boolean {
  if (typeof callbackBody.accepted !== "boolean") return false;
  return callbackBody.accepted === true;
}

// ──────────────────────────────────────────────
// Test QuickPay connection
// ──────────────────────────────────────────────
export async function testQuickPayConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const config = await getQuickPayConfig();
    if (!config.apiKey) return { ok: false, message: "QuickPay API-nøgle er ikke udfyldt" };

    // Test with a simple ping — GET /payments with limit 1
    const res = await fetch(`${BASE_URL}/ping`, {
      headers: {
        "Accept-Version": "v10",
        Authorization: `Basic ${Buffer.from(`:${config.apiKey}`).toString("base64")}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (res.status === 401) return { ok: false, message: "Ugyldig API-nøgle" };
    if (!res.ok) return { ok: false, message: `QuickPay svarede med ${res.status}` };

    return { ok: true, message: "Forbundet til QuickPay" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("timeout") || msg.includes("AbortError")) {
      return { ok: false, message: "Timeout — QuickPay svarer ikke" };
    }
    return { ok: false, message: `Fejl: ${msg}` };
  }
}

// ──────────────────────────────────────────────
// Generate unique order ID for QuickPay
// ──────────────────────────────────────────────
export function generateOrderId(prefix: string, id: number): string {
  // QuickPay requires 4-20 chars, alphanumeric only
  const ts = Date.now().toString(36).slice(-4);
  const raw = `${prefix}${id}${ts}`.replace(/[^a-zA-Z0-9]/g, "");
  return raw.slice(0, 20).padEnd(4, "0");
}
