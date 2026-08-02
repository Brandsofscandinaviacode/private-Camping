import twilio from "twilio";
import nodemailer from "nodemailer";
import { prisma } from "./prisma";
import { logger } from "./logger";

async function getSettings() {
  const settings = await prisma.globalSetting.findMany();
  return Object.fromEntries(settings.map((s) => [s.key, s.value]));
}

// ──────────────────────────────────────────────
// Template rendering
// ──────────────────────────────────────────────
function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || "");
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
    logger.error("twilio", "SMS fejl", msg);
    return { ok: false, error: msg };
  }
}

// ──────────────────────────────────────────────
// Email — two interchangeable providers, picked with the `email_provider`
// setting: "smtp" (nodemailer, the default) or "resend" (HTTP API).
// ──────────────────────────────────────────────

/** Wrap message HTML in the shared CampSense layout. */
function wrapEmailHtml(html: string): string {
  return `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">${html}<p style="color: #888; font-size: 13px; margin-top: 32px;">Drevet af CampSense</p></div>`;
}

async function sendViaSmtp(
  s: Record<string, string>,
  to: string,
  subject: string,
  html: string
): Promise<{ ok: boolean; error?: string }> {
  const host = s.smtp_host;
  const port = parseInt(s.smtp_port || "587", 10);
  const user = s.smtp_user;
  const pass = s.smtp_pass;
  const fromAddr = s.smtp_from || user;

  if (!host || !user || !pass) {
    return { ok: false, error: "SMTP er ikke konfigureret" };
  }

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
    html: wrapEmailHtml(html),
  });
  return { ok: true };
}

async function sendViaResend(
  s: Record<string, string>,
  to: string,
  subject: string,
  html: string
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = s.resend_api_key;
  const fromAddr = s.resend_from;

  if (!apiKey) return { ok: false, error: "Resend API-nøgle mangler" };
  if (!fromAddr) return { ok: false, error: "Resend afsender-adresse mangler" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `CampSense <${fromAddr}>`,
      to: [to],
      subject,
      html: wrapEmailHtml(html),
    }),
  });

  if (!res.ok) {
    // Resend returns { name, message } on error; fall back to the status text.
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.message) detail = body.message;
    } catch {
      /* non-JSON error body — keep the status */
    }
    return { ok: false, error: detail };
  }

  return { ok: true };
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<{ ok: boolean; error?: string }> {
  const s = await getSettings();
  const provider = s.email_provider === "resend" ? "resend" : "smtp";

  try {
    return provider === "resend"
      ? await sendViaResend(s, to, subject, html)
      : await sendViaSmtp(s, to, subject, html);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("email", `Sending fejl (${provider})`, msg);
    return { ok: false, error: msg };
  }
}

// ──────────────────────────────────────────────
// Guest check-in notification (uses templates)
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

  const vars: Record<string, string> = {
    navn: guestName,
    enhed: unitName,
    link: portalUrl,
    dato: new Date().toLocaleDateString("da-DK"),
    email: guestEmail || "",
    telefon: guestPhone || "",
    beløb: "",
    periode: "",
  };

  if (s.notifications_sms_enabled === "true" && guestPhone) {
    const template = s.template_checkin_sms || "Hej {{navn}}! Velkommen til {{enhed}}. Se dit forbrug her: {{link}}";
    results.sms = await sendSMS(guestPhone, renderTemplate(template, vars));
  }

  if (s.notifications_email_enabled === "true" && guestEmail) {
    const subject = renderTemplate(
      s.template_checkin_email_subject || "Velkommen til {{enhed}} — CampSense",
      vars
    );
    const body = renderTemplate(
      s.template_checkin_email_body || "<h2>Velkommen, {{navn}}!</h2><p>Du er checket ind på <strong>{{enhed}}</strong>.</p><p><a href=\"{{link}}\">Åbn gæsteportal</a></p>",
      vars
    );
    results.email = await sendEmail(guestEmail, subject, body);
  }

  return results;
}

// ──────────────────────────────────────────────
// Invoice notification (uses templates)
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

  const vars: Record<string, string> = {
    navn: guestName,
    enhed: unitName,
    link: portalUrl,
    dato: new Date().toLocaleDateString("da-DK"),
    email: guestEmail || "",
    telefon: guestPhone || "",
    beløb: totalAmount.toFixed(2),
    periode: periodLabel,
  };

  if (s.notifications_sms_enabled === "true" && guestPhone) {
    const template = s.template_invoice_sms || "Hej {{navn}}, din faktura for {{periode}} på {{beløb}} DKK er klar. Se detaljer: {{link}}";
    results.sms = await sendSMS(guestPhone, renderTemplate(template, vars));
  }

  if (s.notifications_email_enabled === "true" && guestEmail) {
    const subject = renderTemplate(
      s.template_invoice_email_subject || "Faktura for {{periode}} — CampSense",
      vars
    );
    const body = renderTemplate(
      s.template_invoice_email_body || "<h2>Faktura for {{periode}}</h2><p>Hej {{navn}},</p><p>Din faktura for <strong>{{enhed}}</strong>: <strong>{{beløb}} DKK</strong></p><p><a href=\"{{link}}\">Se faktura</a></p>",
      vars
    );
    results.email = await sendEmail(guestEmail, subject, body);
  }

  return results;
}
