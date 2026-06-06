"use client";

import { useState } from "react";
import Link from "next/link";
import {
  LayoutDashboard, BookOpen, Zap, WashingMachine, Wallet, Settings, LogIn, LogOut,
  Users, QrCode, ChevronDown, Tent, BarChart3, Shield, Wifi, Clock,
} from "lucide-react";
import { Surface } from "@/components/admin/admin-ui";

interface Section {
  id: string;
  icon: React.ElementType;
  title: string;
  intro: string;
  items: string[];
  link?: { href: string; label: string };
}

const sections: Section[] = [
  {
    id: "dashboard",
    icon: LayoutDashboard,
    title: "Dashboard",
    intro:
      "Forsiden giver dig et hurtigt overblik over hele campingpladsen. Øverst ser du nøgletal: belægning, dagens ankomster og afrejser, samlet el- og vandforbrug i realtid, samt den aktuelle elpris hvis du bruger spotpriser.",
    items: [
      "Nøgletal-kortene øverst viser: belægning, dagens ankomster/afrejser, aktuelt forbrug og spotpris.",
      "Enhederne er grupperet efter type (hytter, lejligheder, campingvogne, pladser).",
      "Statusfarver: grøn = ledig, blå = optaget med gæst, gul = reserveret, rød = problem.",
      "Store grupper (f.eks. pladser) vises som en tabel — søg eller filtrér efter status for at finde en enhed hurtigt.",
      "Klik på en enhed for at se detaljer, styre strøm/varme/vand eller tjekke en gæst ind/ud.",
      "Advarsler samles øverst: ubetalte bookinger (rød) og Home Assistant offline (gul) vises ét sted — ikke på hver enhed.",
      "Brug 'Tilføj enhed' for at oprette nye enheder — vælg type og tildel hardware.",
    ],
    link: { href: "/admin", label: "Gå til Dashboard" },
  },
  {
    id: "checkin",
    icon: LogIn,
    title: "Check-in & Check-ud",
    intro:
      "Når en gæst ankommer, checker du dem ind via enhedens detaljeside. Ved afrejse checker du ud, og systemet beregner automatisk det samlede forbrug og pris.",
    items: [
      "Klik på en enhed fra dashboardet og tryk 'Check ind'.",
      "Udfyld gæstens navn, evt. email, telefon og bookingref.",
      "Vælg betalingsform: Efterbetaling (betaler ved check-ud) eller Forudbetalt (betaler et fast beløb ved ankomst).",
      "Ved check-ind tændes strøm automatisk hvis enheden har et relæ konfigureret (Home Assistant eller MQTT/Shelly).",
      "Elmåleren nulstilles ved check-ind, så forbruget starter fra 0 kWh.",
      "Ved check-ud beregnes det samlede forbrug, en opgørelse oprettes, og strøm slukkes automatisk.",
      "Gæsten modtager et unikt link til sin gæsteportal hvor de kan følge forbrug og betale.",
      "Gæstens link er sikret med et unikt token — det kan ikke gættes af andre.",
    ],
  },
  {
    id: "checkout",
    icon: LogOut,
    title: "Afregning & Forbrug",
    intro:
      "Systemet måler el- og vandforbrug løbende og beregner prisen baseret på den valgte prismodel. Cron-jobbet logger forbrug ca. hvert 10. minut og ganger med den gældende timepris.",
    items: [
      "Elforbrug logges automatisk via målere (Home Assistant eller MQTT/Shelly) af cron-jobbet.",
      "Cron-jobbet aflæser hver enheds måler, beregner delta-kWh siden sidst, og ganger med den aktuelle timepris.",
      "Ved spotpris-afregning bruges den nøjagtige timepris for hvert interval — gæsten betaler retfærdigt time for time.",
      "Ved fast pris ganges forbruget med den faste kr/kWh uanset tidspunkt.",
      "Forbrug kan ses i realtid på enhedens detaljeside: aktuelt wattforbrug, akkumuleret kWh og vandforbrug i liter.",
      "Ved check-ud vises en komplet opgørelse med fordelt forbrug, pris pr. kWh og samlet beløb.",
      "Opgørelsen kan sendes til gæsten via email eller ses i gæsteportalen.",
    ],
  },
  {
    id: "bookings",
    icon: BookOpen,
    title: "Bookinger",
    intro:
      "Alle gæsteophold samles under Bookinger. Her kan du filtrere og finde tidligere, aktive og ubetalte bookinger.",
    items: [
      "Filtrer efter status: alle, aktive, reserverede, ubetalte eller betalte.",
      "Klik på en booking for at se detaljer, redigere gæsteinfo eller markere som betalt.",
      "Statusmærker følger samme farver som dashboardet: blå = aktiv, gul = reserveret, rød = ubetalt, grøn = betalt.",
      "Du kan sende opgørelsen til gæsten via email direkte fra bookingsiden.",
    ],
    link: { href: "/admin/bookings", label: "Gå til Bookinger" },
  },
  {
    id: "elpriser",
    icon: Zap,
    title: "Elpriser (Spotpris)",
    intro:
      "Siden viser aktuelle og kommende timepriser fra den danske elbørs via elprisenligenu.dk. Priserne opdateres automatisk. Grafen kombinerer prisdata med dit faktiske elforbrug, så du kan se sammenhængen mellem pris og forbrug time for time.",
    items: [
      "Blå søjler (Spotpris): Viser den rå spotpris i kr/kWh for hver time fra elbørsen.",
      "Gul stiplet linje (Gæstepris / Fast pris): Viser den pris gæsterne reelt betaler, baseret på din valgte prismodel (fast pris, minimumspris eller spotpris + tillæg).",
      "Grøn linje (Forbrug): Viser det samlede elforbrug for hele pladsen i kWh pr. time — data kommer fra dine elmålere via cron-jobbet.",
      "Lilla stiplet linje (Gns. forbrug 7d): Viser gennemsnitligt forbrug pr. time over de sidste 7 dage, så du kan sammenligne med dagens forbrug.",
      "Brug datonavigationen til at bladre mellem dage eller vælg en dato direkte.",
      "Statistikboksene under grafen viser gennemsnit, laveste og højeste spotpris samt totalt logget forbrug for dagen.",
      "Priserne caches i databasen og hentes kun fra API'en når data mangler (typisk 1-2 gange dagligt).",
      "Prisområde (DK1 vest / DK2 øst) konfigureres under Indstillinger.",
    ],
    link: { href: "/admin/elpriser", label: "Gå til Elpriser" },
  },
  {
    id: "services",
    icon: WashingMachine,
    title: "Services (Vask & Bad)",
    intro:
      "Under Services administrerer du vaskemaskiner, tørretumblere og brusere. Gæsterne kan betale og starte maskinerne selv via QR-koder eller links — helt uden at kontakte receptionen.",
    items: [
      "Oversigt: Se status for alle maskiner og brusere (ledig / i brug / udløbet).",
      "Vaskemaskiner & tørretumblere: Opret maskiner med pris, varighed og tilknyttet Shelly-relæ.",
      "Grupper: Saml maskiner i en gruppe (f.eks. 'Vaskeri A') og generer én QR-kode som dækker alle maskiner i gruppen.",
      "Brusere: Opret brusere med pris pr. minut, min/max varighed, og valgfri pause-funktion (gæsten kan pause op til 5 min ad gangen).",
      "Gæsten scanner QR-koden, vælger maskine/tid, betaler via MobilePay/kort (QuickPay), og relæet tændes automatisk.",
      "Brusere: Gæsten kan købe ekstra tid undervejs direkte fra den aktive timer-side.",
      "Auto-stop sikkerhed (3 lag): 1) Browserens timer slukker relæet → 2) Shellys hardware-timer (toggle_after) slukker selv uden server → 3) Cron-jobbet fanger udløbne sessioner som backup.",
      "Hvert bruserlink er sikret med et unikt token, så andre gæster ikke kan styre en andens session.",
    ],
    link: { href: "/admin/services", label: "Gå til Services" },
  },
  {
    id: "economy",
    icon: Wallet,
    title: "Økonomi",
    intro: "Økonomisiden giver dig overblik over indtægter, udestående beløb og forbrugstendenser.",
    items: [
      "Se samlet omsætning, ubetalte beløb og antal bookinger.",
      "Forbrugsstatistik over tid (el, vand, vask, bad).",
      "Eksportér data til CSV for regnskab.",
    ],
    link: { href: "/admin/economy", label: "Gå til Økonomi" },
  },
  {
    id: "guest-portal",
    icon: Users,
    title: "Gæsteportal",
    intro: "Hver gæst får et unikt link (token) til deres gæsteportal, hvor de kan følge med i deres ophold.",
    items: [
      "Gæsten ser sit forbrug (el, vand), akkumuleret pris og forventet check-ud dato.",
      "Adgang til services: start vask, book bruser, se ledige maskiner.",
      "Praktisk info (WiFi, regler, nødnumre) kan tilpasses per enhedstype under Indstillinger.",
      "For fastliggere er portalen permanent — den nulstilles ikke ved check-ud.",
      "Linket sendes automatisk ved check-ind hvis email-notifikationer er aktiveret.",
    ],
  },
  {
    id: "qr",
    icon: QrCode,
    title: "QR-koder",
    intro: "QR-koder bruges til at give gæster hurtig adgang til vaskeri og brusere uden at logge ind.",
    items: [
      "Under Services → Grupper kan du generere QR-koder til vaskegrupper.",
      "Print og sæt QR-koden op ved maskinen — gæsten scanner, betaler og starter.",
      "Brusere har hurtigkoder (f.eks. 1001, 1002) som kan printes som QR eller bruges direkte.",
      "QR-koderne peger på offentlige sider der ikke kræver login.",
    ],
  },
  {
    id: "settings-general",
    icon: Settings,
    title: "Indstillinger",
    intro: "Under Indstillinger konfigurerer du alt fra priser til hardware-integration. Indstillingerne er opdelt i faner.",
    items: [
      "Generelt: Sidens navn, URL, prismodel (fast pris, minimumspris eller spotpris + tillæg), el- og vandpris, prisområde.",
      "Home Assistant: URL og adgangstoken til din HA-installation for at styre relæer og læse målere.",
      "MQTT: Mosquitto-broker til direkte Shelly-integration uden Home Assistant.",
      "Notifikationer: Email-afsender (SMTP) og SMS (Twilio) til gæstebeskeder.",
      "Betaling: QuickPay API-nøgle og merchant-id til online betaling.",
      "Gæsteportal: Tilpas praktisk info-teksten per enhedstype (dansk/engelsk/tysk).",
      "Pladser: Konfigurér hardware (entity IDs / MQTT prefix) for hver enkelt enhed.",
      "System: Skift adgangskode, se API-nøgle til cron, systemstatus.",
    ],
    link: { href: "/admin/settings", label: "Gå til Indstillinger" },
  },
  {
    id: "hardware",
    icon: Wifi,
    title: "Hardware & Integration",
    intro: "CampSense understøtter to måder at styre fysisk hardware (relæer, målere): Home Assistant og direkte MQTT (Shelly).",
    items: [
      "Home Assistant (HA): Forbind via REST API. Enheder styres med entity IDs (f.eks. switch.hytte1_el).",
      "MQTT / Shelly: Forbind direkte til Shelly Gen2/3+ enheder via en Mosquitto-broker. Angiv MQTT-prefix og komponent (f.eks. shellyplus1pm-abc123 / switch:0).",
      "Hver enhed kan have sin egen kilde (HA eller MQTT) per funktion (el, varme, vand).",
      "For vaskemaskiner og brusere vælges kilden per maskine.",
      "MQTT-enheder får automatisk hardware-timer (toggle_after) som sikkerhedsnet — enheden slukker sig selv uanset server/browser-status.",
    ],
  },
  {
    id: "pricing",
    icon: BarChart3,
    title: "Prismodeller",
    intro: "Systemet understøtter tre prismodeller for el. Modellen vælges under Indstillinger → Generelt.",
    items: [
      "Fast pris: Gæsten betaler en fast kr/kWh uanset timepris. Simpelt og forudsigeligt.",
      "Minimumspris: Gæsten betaler mindst din faste pris, men hvis spotprisen er højere, betaler de spotprisen. Beskytter dig mod tab ved høje spotpriser.",
      "Spotpris + tillæg: Gæsten betaler den aktuelle timepris plus et fast tillæg. Mest retfærdig, men prisen varierer time for time.",
      "Forbrug logges løbende af cron-jobbet som ganger hvert intervals forbrug med den gældende timepris.",
    ],
  },
  {
    id: "cron",
    icon: Clock,
    title: "Cron (Automatisk vedligeholdelse)",
    intro: "Et cron-job kalder /api/cron hvert minut. Det sørger for at alt kører automatisk i baggrunden. Opgaverne er delt i hurtige (hvert kald) og tunge (hvert ~10 min) for at undgå unødig belastning.",
    items: [
      "Opsætning: Sæt din crontab til at kalde endpointet hvert minut: * * * * * curl -H 'Authorization: Bearer <api_key>' http://din-server:3000/api/cron",
      "Hurtige opgaver (hvert kald): Tjekker om brusere/vaskemaskiner er udløbet og slukker dem øjeblikkeligt.",
      "Tunge opgaver (hvert ~10 min): Logger elforbrug fra alle målere, opdaterer spotpriser (kun hvis data mangler), tjekker forbrug-alarmer og sender udestående fakturaer.",
      "Spotpriser hentes kun 1-2 gange dagligt — når dagens priser mangler, og igen efter kl. 13 når morgendagens priser publiceres.",
      "Forbrugslogning: Aflæser hver enheds elmåler, beregner kWh-delta siden sidst, og gemmer med den aktuelle timepris.",
      "API-nøglen finder du under Indstillinger → System.",
      "Systemstatus viser hvornår cron sidst kørte, om der var fejl, og hvornår tunge opgaver sidst blev udført.",
    ],
  },
  {
    id: "security",
    icon: Shield,
    title: "Adgang & Sikkerhed",
    intro: "Admin-panelet kræver login. Gæsteportalen og offentlige service-sider kræver et unikt token.",
    items: [
      "Admin-login: Brugernavn og adgangskode. Skift adgangskode under Indstillinger → System.",
      "Gæste-tokens: Genereres automatisk ved check-ind og er unikke per ophold.",
      "API-nøgle: Bruges af cron og eventuelle eksterne integrationer. Vis/regenerér under Indstillinger → System.",
      "Offentlige vask/bruser-sider kræver et gruppetoken, men ingen login.",
    ],
  },
];

export function HelpContent() {
  const [openId, setOpenId] = useState<string | null>("dashboard");

  return (
    <div className="space-y-2.5">
      {sections.map((s) => {
        const Icon = s.icon;
        const isOpen = openId === s.id;
        return (
          <Surface key={s.id} className="overflow-hidden">
            <button
              onClick={() => setOpenId(isOpen ? null : s.id)}
              className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/40 transition-colors"
            >
              <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Icon className="h-[18px] w-[18px] text-primary" />
              </div>
              <span className="font-semibold text-sm flex-1">{s.title}</span>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>
            {isOpen && (
              <div className="px-4 pb-4 pt-0">
                <p className="text-sm text-muted-foreground mb-3 leading-relaxed">{s.intro}</p>
                <ul className="space-y-1.5">
                  {s.items.map((item, i) => (
                    <li key={i} className="text-sm text-foreground/80 flex gap-2 leading-relaxed">
                      <span className="text-primary/60 mt-1.5 shrink-0">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                {s.link && (
                  <Link href={s.link.href} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary mt-3 hover:underline">
                    {s.link.label} →
                  </Link>
                )}
              </div>
            )}
          </Surface>
        );
      })}

      <p className="text-[10px] text-center text-muted-foreground/40 pt-4 pb-2 flex items-center justify-center gap-1">
        <Tent className="h-3 w-3" />
        CampSense
      </p>
    </div>
  );
}
