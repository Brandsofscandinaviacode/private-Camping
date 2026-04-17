import { NextResponse } from "next/server";

const spec = {
  openapi: "3.0.3",
  info: {
    title: "CampSense API",
    version: "1.1.0",
    description: "REST API til integration med booking-systemer og eksterne tjenester. Alle endpoints kræver en API-nøgle sat i Indstillinger > System.",
  },
  servers: [{ url: "/api/v1", description: "CampSense API v1" }],
  security: [{ BearerAuth: [] }],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "API-nøgle konfigureret i CampSense indstillinger",
      },
    },
  },
  paths: {
    "/units": {
      get: {
        summary: "Hent alle enheder",
        tags: ["Enheder"],
        responses: {
          "200": {
            description: "Liste af enheder",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    units: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "integer" },
                          name: { type: "string" },
                          type: { type: "string", enum: ["CABIN", "SEASONAL", "CARAVAN", "PITCH"] },
                          status: { type: "string", enum: ["VACANT", "OCCUPIED"] },
                          isLongTerm: { type: "boolean" },
                          longTermGuestName: { type: "string", nullable: true },
                          longTermGuestEmail: { type: "string", nullable: true },
                          longTermGuestPhone: { type: "string", nullable: true },
                          longTermPortalToken: { type: "string", nullable: true, description: "Permanent gæsteportal-token for fastliggere" },
                          hardware: {
                            type: "object",
                            nullable: true,
                            properties: {
                              hasElectricity: { type: "boolean" },
                              hasHeating: { type: "boolean", description: "Separat varme-relæ (elradiatorer)" },
                              winterModeEnabled: { type: "boolean", description: "Behold varme tændt når enheden er tom (frostsikring)" },
                              hasWater: { type: "boolean" },
                              hasClimate: { type: "boolean" },
                              hasSmartLock: { type: "boolean" },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/sessions": {
      get: {
        summary: "Hent sessioner/ophold",
        tags: ["Sessioner"],
        parameters: [
          { name: "unit_id", in: "query", schema: { type: "integer" }, description: "Filtrér efter enhed" },
          { name: "status", in: "query", schema: { type: "string", enum: ["active", "completed"] }, description: "Filtrér efter status" },
        ],
        responses: {
          "200": {
            description: "Liste af sessioner (maks 100)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    sessions: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "integer" },
                          unitId: { type: "integer" },
                          unitName: { type: "string" },
                          unitType: { type: "string", enum: ["CABIN", "SEASONAL", "CARAVAN", "PITCH"] },
                          guestName: { type: "string" },
                          guestEmail: { type: "string", nullable: true },
                          guestPhone: { type: "string", nullable: true },
                          bookingRef: { type: "string", nullable: true },
                          status: { type: "string", enum: ["ACTIVE", "COMPLETED"] },
                          paymentStatus: { type: "string", enum: ["UNPAID", "PAID", "REFUNDED"] },
                          paymentId: { type: "string", nullable: true },
                          paidAt: { type: "string", format: "date-time", nullable: true },
                          checkInTime: { type: "string", format: "date-time" },
                          checkOutTime: { type: "string", format: "date-time", nullable: true },
                          expectedCheckOut: { type: "string", format: "date-time", nullable: true },
                          startKwh: { type: "number", nullable: true },
                          endKwh: { type: "number", nullable: true },
                          startHeatingKwh: { type: "number", nullable: true, description: "Baseline for separat varme-måler" },
                          endHeatingKwh: { type: "number", nullable: true },
                          startWaterLiters: { type: "number", nullable: true },
                          endWaterLiters: { type: "number", nullable: true },
                          totalElectricityCost: { type: "number", nullable: true, description: "Endelig el-pris (populated ved check-out). Null for ACTIVE sessioner — brug accumulatedElCost i stedet." },
                          totalWaterCost: { type: "number", nullable: true },
                          totalCost: { type: "number", nullable: true },
                          accumulatedElCost: { type: "number", description: "Tidsvægtet el-omkostning opdateret hvert 10. min af cron-ticket. Autoritativ værdi for ACTIVE sessioner." },
                          accumulatedElKwh: { type: "number" },
                          accumulatedWaterCost: { type: "number" },
                          accumulatedWaterLiters: { type: "number" },
                          lastTickAt: { type: "string", format: "date-time", nullable: true, description: "Tidspunkt for seneste tick-opdatering af accumulator-felterne" },
                          billingMode: { type: "string", enum: ["PREPAID", "POSTPAID"] },
                          prepaidAmount: { type: "number", nullable: true },
                          pricePerKwhOverride: { type: "number", nullable: true, description: "Per-booking override. Null = brug global pricing." },
                          pricePerLiterWaterOverride: { type: "number", nullable: true },
                          externalPrice: { type: "number", nullable: true },
                          externalDescription: { type: "string", nullable: true },
                          laundryCredit: { type: "number" },
                          notes: { type: "string", nullable: true },
                          guestPortalToken: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        summary: "Check-in: opret nyt ophold",
        description: "Checker en gæst ind, tænder strøm, aflæser målere og opretter gæsteportal. Bruges til integration med booking-systemer.",
        tags: ["Sessioner"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["unit_id", "guest_name"],
                properties: {
                  unit_id: { type: "integer", description: "Enhedens ID" },
                  guest_name: { type: "string", description: "Gæstens fulde navn" },
                  guest_email: { type: "string", description: "Gæstens email (til notifikationer)" },
                  guest_phone: { type: "string", description: "Gæstens telefonnummer med landekode" },
                  booking_ref: { type: "string", description: "Booking-reference fra eksternt system" },
                  expected_checkout: { type: "string", format: "date-time", description: "Forventet afrejse (ISO 8601)" },
                  billing_mode: { type: "string", enum: ["POSTPAID", "PREPAID"], description: "POSTPAID = betal ved checkout (standard), PREPAID = forudbetalt" },
                  prepaid_amount: { type: "number", description: "Forudbetalt beløb i DKK (kun ved billing_mode=PREPAID)" },
                  external_price: { type: "number", description: "Opholdspris fra booking-system (lægges oven i forbrugsomkostninger)" },
                  external_description: { type: "string", description: "Beskrivelse af ekstern pris (f.eks. '3 nætter hytte')" },
                },
              },
              example: {
                unit_id: 1,
                guest_name: "Hans Jensen",
                guest_email: "hans@email.dk",
                guest_phone: "+4512345678",
                booking_ref: "BK-2026-001",
                expected_checkout: "2026-04-20T11:00:00Z",
                external_price: 1500.00,
                external_description: "3 nætter hytte",
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Check-in gennemført",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    session_id: { type: "integer" },
                    guest_portal_token: { type: "string" },
                    guest_portal_url: { type: "string", description: "Fuldt link til gæsteportal" },
                    status: { type: "string" },
                  },
                },
              },
            },
          },
          "400": {
            description: "Ugyldig forespørgsel",
            content: { "application/json": { schema: { type: "object", properties: { error: { type: "string" } } } } },
          },
        },
      },
      patch: {
        summary: "Opdater session (check-out, sæt pris, markér betalt)",
        tags: ["Sessioner"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["session_id", "action"],
                properties: {
                  session_id: { type: "integer" },
                  action: { type: "string", enum: ["checkout", "set_price", "mark_paid"], description: "checkout: aflæs målere og afslut. set_price: sæt ekstern pris. mark_paid: markér som betalt." },
                  external_price: { type: "number", description: "Pris fra eksternt system (kun til set_price)" },
                  external_description: { type: "string", description: "Beskrivelse (kun til set_price)" },
                  payment_id: { type: "string", description: "Betalings-ID fra eksternt system (kun til mark_paid)" },
                },
              },
              examples: {
                checkout: { summary: "Check-out", value: { session_id: 1, action: "checkout" } },
                set_price: { summary: "Sæt ekstern pris", value: { session_id: 1, action: "set_price", external_price: 1500, external_description: "3 nætter" } },
                mark_paid: { summary: "Markér betalt", value: { session_id: 1, action: "mark_paid", payment_id: "PAY-123" } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Session opdateret",
            content: {
              "application/json": {
                examples: {
                  checkout: {
                    summary: "Check-out resultat",
                    value: {
                      totalElectricityCost: 125.50,
                      totalWaterCost: 42.00,
                      totalCost: 167.50,
                      externalPrice: 1500.00,
                      grandTotal: 1667.50,
                    },
                  },
                  set_price: { summary: "Pris sat", value: { ok: true } },
                  mark_paid: { summary: "Markeret betalt", value: { ok: true } },
                },
              },
            },
          },
        },
      },
    },
    "/invoices": {
      get: {
        summary: "Hent fakturaer",
        description: "Hent fakturaer for fastliggere og afsluttede ophold. Kan filtreres på enhed og status.",
        tags: ["Fakturaer"],
        parameters: [
          { name: "unit_id", in: "query", schema: { type: "integer" }, description: "Filtrér efter enhed" },
          { name: "status", in: "query", schema: { type: "string", enum: ["DRAFT", "PENDING", "PAID", "OVERDUE"] }, description: "Filtrér efter status" },
          { name: "limit", in: "query", schema: { type: "integer", default: 100, maximum: 500 }, description: "Maks antal resultater" },
        ],
        responses: {
          "200": {
            description: "Liste af fakturaer",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    invoices: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "integer" },
                          unitId: { type: "integer" },
                          unitName: { type: "string" },
                          periodStart: { type: "string", format: "date-time" },
                          periodEnd: { type: "string", format: "date-time" },
                          startKwh: { type: "number", nullable: true },
                          endKwh: { type: "number", nullable: true },
                          startHeatingKwh: { type: "number", nullable: true },
                          endHeatingKwh: { type: "number", nullable: true },
                          startWaterLiters: { type: "number", nullable: true },
                          endWaterLiters: { type: "number", nullable: true },
                          electricityCost: { type: "number" },
                          waterCost: { type: "number" },
                          totalAmount: { type: "number" },
                          status: { type: "string", enum: ["DRAFT", "PENDING", "PAID", "OVERDUE"] },
                          paidAt: { type: "string", format: "date-time", nullable: true },
                          paymentId: { type: "string", nullable: true },
                          createdAt: { type: "string", format: "date-time" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/consumption": {
      get: {
        summary: "Hent forbrugsdata",
        tags: ["Forbrug"],
        parameters: [
          { name: "session_id", in: "query", schema: { type: "integer" }, description: "Live forbrug for aktiv session" },
          { name: "unit_id", in: "query", schema: { type: "integer" }, description: "Historisk forbrug for enhed" },
          { name: "days", in: "query", schema: { type: "integer", default: 7 }, description: "Antal dage tilbage (bruges med unit_id)" },
          { name: "total", in: "query", schema: { type: "string", enum: ["true"] }, description: "Nuværende total forbrugshastighed (alle enheder)" },
          { name: "pricing", in: "query", schema: { type: "string", enum: ["true"] }, description: "Nuværende priser" },
        ],
        responses: {
          "200": {
            description: "Forbrugsdata",
            content: {
              "application/json": {
                examples: {
                  live: {
                    summary: "Live forbrug (session_id) — tidsvægtet accumulator + ongoing delta",
                    value: {
                      usedKwh: 12.5,
                      electricityCost: 31.25,
                      usedKwhMain: 8.2,
                      usedKwhHeating: 4.3,
                      hasHeatingMeter: true,
                      usedWaterLiters: 250,
                      waterCost: 12.50,
                      totalLiveCost: 43.75,
                      currency: "DKK",
                      pricePerKwh: 2.50,
                      spotPrice: 1.87,
                      pricingMode: "spot",
                    },
                  },
                  total: {
                    summary: "Total forbrugshastighed (total=true)",
                    value: { totalKwhPerHour: 2.4, totalWaterLitersPerHour: 15.0, unitCount: 5 },
                  },
                  pricing: {
                    summary: "Priser (pricing=true)",
                    value: {
                      pricePerKwh: 2.50,
                      pricePerLiterWater: 0.05,
                      currency: "DKK",
                      pricingMode: "spot",
                      elSurcharge: 0.50,
                      edsPriceArea: "DK1",
                      effectiveElPrice: { pricePerKwh: 2.37, spotPrice: 1.87, mode: "spot" },
                    },
                  },
                  logs: {
                    summary: "Historisk forbrug (unit_id)",
                    value: {
                      logs: [
                        { recordedAt: "2026-04-17T10:30:00.000Z", electricityKwh: 25.5, waterLiters: 180 },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

// GET /api/docs — OpenAPI JSON spec
export async function GET() {
  return NextResponse.json(spec);
}
