"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { Check, Copy, Loader2, Printer, Send, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resendGuestNotification } from "@/lib/actions";

// ──────────────────────────────────────────────
// One guest link for screen, QR and print
// ──────────────────────────────────────────────
// The link uses Site URL — the address e-mails and the laundry/shower QR
// codes use — and falls back to the address the desk is on. If the two point
// at different hosts the desk is told, since one of them is then wrong.

const noopSubscribe = () => () => {};

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function usePortalUrl(path: string, siteUrl: string) {
  const origin = useSyncExternalStore(noopSubscribe, () => window.location.origin, () => null);
  const base = siteUrl || origin || "";
  const siteHost = siteUrl ? hostOf(siteUrl) : null;
  const deskHost = origin ? hostOf(origin) : null;
  const mismatch =
    !!siteHost && !!deskHost && siteHost !== deskHost && !/^(localhost|127\.)/.test(deskHost)
      ? { siteHost, deskHost }
      : null;
  return { url: base ? `${base}${path}` : "", mismatch };
}

export function PortalUrlWarning({ mismatch }: { mismatch: { siteHost: string; deskHost: string } | null }) {
  if (!mismatch) return null;
  return (
    <p className="flex items-start gap-1.5 text-xs text-amber-700">
      <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <span>
        Linket bruger Site URL ({mismatch.siteHost}), men du er på {mismatch.deskHost}. Virker linket ikke for gæsten, så
        ret Site URL under <Link href="/admin/settings" className="underline">Indstillinger</Link>.
      </span>
    </p>
  );
}

export function PortalQr({ url, size = 160, onReady }: { url: string; size?: number; onReady?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });

  useEffect(() => {
    if (!canvasRef.current || !url) return;
    QRCode.toCanvas(canvasRef.current, url, { width: size, margin: 1, color: { dark: "#000000", light: "#FFFFFF" } })
      .then(() => onReadyRef.current?.())
      .catch(() => {});
  }, [url, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      aria-label="QR-kode til gæsteportalen"
      className="rounded-md border border-border/60 bg-white"
      style={{ width: size, height: size }}
    />
  );
}

function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
  return Promise.resolve();
}

/** QR code, visible link, copy and "print welcome slip" — for the desk. */
export function PortalHandover({
  sessionId,
  portalPath,
  siteUrl,
  qrSize = 132,
}: {
  sessionId: number;
  portalPath: string;
  siteUrl: string;
  qrSize?: number;
}) {
  const { url, mismatch } = usePortalUrl(portalPath, siteUrl);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await copyText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Kopiér dette link:", url);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
        {url && <PortalQr url={url} size={qrSize} />}
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs text-muted-foreground">Gæsten kan scanne koden eller åbne linket:</p>
          <p className="font-mono text-xs break-all select-all rounded-md bg-muted/60 px-2 py-1.5">{url || portalPath}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleCopy} disabled={!url}>
              {copied ? <Check className="h-3.5 w-3.5 mr-1.5 text-primary" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
              {copied ? "Kopieret!" : "Kopiér link"}
            </Button>
            <a href={`/admin/bookings/${sessionId}/welcome?print=1`} target="_blank" rel="noopener">
              <Button type="button" variant="outline" size="sm">
                <Printer className="h-3.5 w-3.5 mr-1.5" />
                Udskriv velkomstseddel
              </Button>
            </a>
          </div>
        </div>
      </div>
      <PortalUrlWarning mismatch={mismatch} />
    </div>
  );
}

/** Large QR code for the printed welcome slip; prints itself once drawn when asked to. */
export function WelcomeSlipQr({ portalPath, siteUrl, autoPrint }: { portalPath: string; siteUrl: string; autoPrint: boolean }) {
  const { url, mismatch } = usePortalUrl(portalPath, siteUrl);
  const printed = useRef(false);

  function handleReady() {
    if (!autoPrint || printed.current) return;
    printed.current = true;
    setTimeout(() => window.print(), 200);
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {url && <PortalQr url={url} size={220} onReady={handleReady} />}
      <p className="font-mono text-xs break-all text-center">{url}</p>
      <div className="print:hidden">
        <PortalUrlWarning mismatch={mismatch} />
      </div>
    </div>
  );
}

/** "Gæsteportal" card on an active booking: hand-over plus resend with the real result. */
export function GuestPortalCard({
  sessionId,
  portalPath,
  siteUrl,
  emailEnabled,
  smsEnabled,
  hasEmail,
  hasPhone,
}: {
  sessionId: number;
  portalPath: string;
  siteUrl: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
}) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const canSend = (emailEnabled && hasEmail) || (smsEnabled && hasPhone);
  const whyNot = !emailEnabled && !smsEnabled
    ? "E-mail og SMS er slået fra under Indstillinger."
    : emailEnabled && smsEnabled
      ? "Bookingen har hverken e-mail eller telefonnummer."
      : emailEnabled
        ? "Bookingen har ingen e-mail (SMS er slået fra)."
        : "Bookingen har intet telefonnummer (e-mail er slået fra).";

  async function handleSend() {
    setSending(true);
    setResult(null);
    try {
      setResult(await resendGuestNotification(sessionId));
    } catch {
      setResult({ ok: false, message: "Afsendelsen fejlede på grund af en teknisk fejl. Prøv igen." });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="px-5 py-4 border-b border-border flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Gæsteportal</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {canSend
              ? "Vis gæsten QR-koden, udskriv en velkomstseddel eller send linket igen."
              : `${whyNot} Giv gæsten QR-koden eller linket her.`}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleSend}
          disabled={sending || !canSend}
          title={canSend ? undefined : whyNot}
        >
          {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
          {sending ? "Sender..." : "Send portal-link igen"}
        </Button>
      </div>
      <div className="p-5 space-y-3">
        {result && (
          <p
            role="status"
            className={`text-sm p-2 rounded-lg ${result.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}
          >
            {result.message}
          </p>
        )}
        <PortalHandover sessionId={sessionId} portalPath={portalPath} siteUrl={siteUrl} />
      </div>
    </div>
  );
}
