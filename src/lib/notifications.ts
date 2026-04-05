import twilio from "twilio";
import nodemailer from "nodemailer";
import { prisma } from "./prisma";

async function getSettings() {
  const settings = await prisma.globalSetting.findMany();
  return Object.fromEntries(settings.map((s) => [s.key, s.value]));
}

// ──────────────────────────────────────────────
// SMS via Twilio
// ──────────────────────────────────────────────
export async function sendSMS(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const s = await getSettings();
  const sid = s.twilio_account_sid;
  const token = s.twilio_auth_token;
  const from = s.twilio_phone_number;

  if (!sid || !token || !from) {
    return { ok: false, error: "Twilio er ikke konfigureret" };
  }

  try {
    const client = twilio(sid, token);
    await client.messages.create({ body, from, to });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Twilio SMS fejl:", msg);
    return { ok: false, error: msg };
  }
}

// ──────────────────────────────────────────────
// Email via SMTP (nodemailer)
// ──────────────────────────────────────────────
export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<{ ok: boolean; error?: string }> {
  const s = await getSettings();
  const host = s.smtp_host;
  const port = parseInt(s.smtp_port || "587", 10);
  const user = s.smtp_user;
  const pass = s.smtp_pass;
  const fromAddr = s.smtp_from || user;

  if (!host || !user || !pass) {
    return { ok: false, error: "SMTP er ikke konfigureret" };
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    await transporter.sendMail({
      from: `CampSense <${fromAddr}>`,
      to,
      subject,
      html,
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Email fejl:", msg);
    return { ok: false, error: msg };
  }
}

// ──────────────────────────────────────────────
// Guest check-in notification
// ──────────────────────────────────────────────
export async function sendCheckInNotification(
  guestName: string,
  guestPhone: string | null | undefined,
  guestEmail: string | null | undefined,
  portalUrl: string,
  unitName: string
): Promise<{ sms?: { ok: boolean; error?: string }; email?: { ok: boolean; error?: string } }> {
  const s = await getSettings();
  const results: { sms?: { ok: boolean; error?: string }; email?: { ok: boolean; error?: string } } = {};

  const smsEnabled = s.notifications_sms_enabled === "true";
  const emailEnabled = s.notifications_email_enabled === "true";

  if (smsEnabled && guestPhone) {
    results.sms = await sendSMS(
      guestPhone,
      `Hej ${guestName}! Velkommen til ${unitName}. Se dit forbrug og styr din enhed her: ${portalUrl}`
    );
  }

  if (emailEnabled && guestEmail) {
    results.email = await sendEmail(
      guestEmail,
      `Velkommen til ${unitName} — CampSense`,
      `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>Velkommen, ${guestName}!</h2>
          <p>Du er nu checket ind på <strong>${unitName}</strong>.</p>
          <p>Via din gæsteportal kan du se dit forbrug af strøm og vand i realtid:</p>
          <p style="margin: 24px 0;">
            <a href="${portalUrl}" style="background: #2d7a4f; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
              Åbn gæsteportal
            </a>
          </p>
          <p style="color: #888; font-size: 13px;">Drevet af CampSense</p>
        </div>
      `
    );
  }

  return results;
}

// ──────────────────────────────────────────────
// Invoice notification for long-term renters
// ──────────────────────────────────────────────
export async function sendInvoiceNotification(
  guestName: string,
  guestPhone: string | null | undefined,
  guestEmail: string | null | undefined,
  portalUrl: string,
  unitName: string,
  totalAmount: number,
  periodLabel: string
): Promise<{ sms?: { ok: boolean; error?: string }; email?: { ok: boolean; error?: string } }> {
  const s = await getSettings();
  const results: { sms?: { ok: boolean; error?: string }; email?: { ok: boolean; error?: string } } = {};

  if (s.notifications_sms_enabled === "true" && guestPhone) {
    results.sms = await sendSMS(
      guestPhone,
      `Hej ${guestName}, din faktura for ${periodLabel} på ${totalAmount.toFixed(2)} DKK er klar. Se detaljer: ${portalUrl}`
    );
  }

  if (s.notifications_email_enabled === "true" && guestEmail) {
    results.email = await sendEmail(
      guestEmail,
      `Faktura for ${periodLabel} — CampSense`,
      `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>Faktura for ${periodLabel}</h2>
          <p>Hej ${guestName},</p>
          <p>Din månedlige faktura for <strong>${unitName}</strong> er klar.</p>
          <p style="font-size: 24px; font-weight: bold; margin: 16px 0;">${totalAmount.toFixed(2)} DKK</p>
          <p>Se forbrugsdetaljer og betal via din gæsteportal:</p>
          <p style="margin: 24px 0;">
            <a href="${portalUrl}" style="background: #2d7a4f; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
              Se faktura
            </a>
          </p>
          <p style="color: #888; font-size: 13px;">Drevet af CampSense</p>
        </div>
      `
    );
  }

  return results;
}
