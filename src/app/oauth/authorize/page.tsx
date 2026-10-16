import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AlertTriangle, Bot, Check, Eye, ShieldCheck, Tent, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getVerifiedAdmin } from "@/lib/auth";
import {
  AUTHORIZE_FIELDS,
  buildRedirect,
  isKnownClaudeRedirect,
  isMcpEnabled,
  originFromHeaders,
  validateAuthorizeRequest,
} from "@/lib/mcp/oauth";
import { approveAuthorization, denyAuthorization } from "./actions";

// OAuth consent page: an admin approves (or denies) read-only MCP access for
// Claude. Not under /admin, so it checks the session itself.
export const dynamic = "force-dynamic";

const READABLE = [
  "Enheder og målere — også live aflæsning af Shelly/Home Assistant",
  "Ophold og bookinger med gæstenavne (e-mail og telefon vises maskeret)",
  "Afregning, forudbetalte saldi og fakturaer",
  "Vaskeri, bad, elpriser, systemstatus og app-logs",
];

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-muted/30">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="h-14 w-14 rounded-2xl bg-primary flex items-center justify-center mx-auto">
            <Tent className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-bold mt-4 tracking-tight">CampSense</h1>
        </div>
        <div className="rounded-xl border border-border/60 bg-card shadow-sm">{children}</div>
      </div>
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Shell>
      <div className="p-5 space-y-2">
        <h2 className="font-semibold">{title}</h2>
        <div className="text-sm text-muted-foreground space-y-2">{children}</div>
      </div>
    </Shell>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params: Record<string, string | undefined> = {};
  for (const key of AUTHORIZE_FIELDS) {
    const v = raw[key];
    const value = Array.isArray(v) ? v[0] : v;
    if (value) params[key] = value;
  }
  const origin = originFromHeaders(await headers());

  if (!(await isMcpEnabled())) {
    return (
      <Notice title="MCP-adgang er slået fra">
        <p>Claude kan ikke forbindes, før MCP-adgang er slået til.</p>
        <p>
          Slå den til under{" "}
          <Link href="/admin/settings" className="text-primary underline">Indstillinger → Claude / MCP</Link>{" "}
          og prøv derefter at forbinde igen.
        </p>
      </Notice>
    );
  }

  const v = await validateAuthorizeRequest(params, origin);
  if (!v.ok && !v.redirectable) {
    return (
      <Notice title="Ugyldig forespørgsel">
        <p>{v.error}</p>
        <p>Der er ikke givet adgang. Prøv at tilføje connectoren igen fra Claude.</p>
      </Notice>
    );
  }
  if (!v.ok) {
    // Registration is open, so a "registered" redirect URI may belong to
    // anyone. Bounce errors back automatically only to Claude itself —
    // otherwise this page would be an open redirector.
    if (isKnownClaudeRedirect(v.redirectUri)) {
      redirect(buildRedirect(v.redirectUri, {
        error: v.error, error_description: v.description, state: v.state, iss: origin,
      }));
    }
    return (
      <Notice title="Ugyldig forespørgsel">
        <p>{v.description} ({v.error})</p>
        <p>Forespørgslen kom fra {new URL(v.redirectUri).host}. Der er ikke givet adgang.</p>
      </Notice>
    );
  }

  const admin = await getVerifiedAdmin();
  if (!admin) {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${qs}`)}`);
  }

  const { req } = v;
  const redirectHost = new URL(req.redirectUri).host;
  const trusted = isKnownClaudeRedirect(req.redirectUri);
  const appName = req.clientName?.trim() || "Ukendt app";

  const hidden = AUTHORIZE_FIELDS.map((key) =>
    params[key] !== undefined ? <input key={key} type="hidden" name={key} value={params[key]} /> : null,
  );

  return (
    <Shell>
      <div className="px-5 py-4 border-b border-border flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Bot className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0">
          <h2 className="font-semibold leading-tight truncate">{appName}</h2>
          <p className="text-xs text-muted-foreground">vil have læseadgang til CampSense</p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div>
          <p className="text-sm font-medium flex items-center gap-1.5"><Eye className="h-4 w-4" /> Kan læse</p>
          <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            {READABLE.map((item) => (
              <li key={item} className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />{item}</li>
            ))}
          </ul>
        </div>

        <p className="text-sm flex gap-2 rounded-lg bg-muted/50 px-3 py-2">
          <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
          Kan ikke ændre noget — ingen check-in/-ud, ingen strøm, ingen betalinger. Adgangen kan fjernes under Indstillinger → Claude / MCP.
        </p>

        <div className="text-sm">
          <p className="text-muted-foreground">Adgangen sendes til</p>
          <p className="font-mono font-semibold text-base break-all">{redirectHost}</p>
        </div>

        {!trusted && (
          <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <p>
              <b>Dette er ikke Claude.</b> {redirectHost} er hverken claude.ai, claude.com eller din egen computer.
              Godkend kun, hvis du selv har startet forbindelsen fra denne app.
            </p>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <form action={denyAuthorization} className="flex-1">
            {hidden}
            <Button type="submit" variant="outline" className="w-full">
              <X className="h-4 w-4 mr-1.5" /> Afvis
            </Button>
          </form>
          <form action={approveAuthorization} className="flex-1">
            {hidden}
            <Button type="submit" className="w-full">
              <Check className="h-4 w-4 mr-1.5" /> Godkend
            </Button>
          </form>
        </div>
        <p className="text-xs text-muted-foreground text-center">Logget ind som {admin.username}</p>
      </div>
    </Shell>
  );
}
