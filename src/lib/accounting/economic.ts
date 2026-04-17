import { logger } from "@/lib/logger";
import type { AccountingProvider, AccountingInvoice, AccountingPayment, SyncResult } from "./types";

const BASE_URL = "https://restapi.e-conomic.com";

interface EconomicConfig {
  appSecretToken: string;
  agreementGrantToken: string;
  defaultPaymentTermsNumber: number;
  defaultProductNumber: number;
  defaultVatZoneNumber: number;
  customerGroupNumber: number;
}

function headers(config: EconomicConfig): Record<string, string> {
  return {
    "X-AppSecretToken": config.appSecretToken,
    "X-AgreementGrantToken": config.agreementGrantToken,
    "Content-Type": "application/json",
  };
}

async function request(
  config: EconomicConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: headers(config),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

async function findOrCreateCustomer(
  config: EconomicConfig,
  name: string,
  email?: string,
): Promise<{ customerNumber: number }> {
  const searchName = name.slice(0, 50);
  const search = await request(config, "GET",
    `/customers?filter=name$eq:${encodeURIComponent(searchName)}&pagesize=1`,
  );

  if (search.ok) {
    const collection = search.data as { collection?: { customerNumber: number }[] };
    if (collection.collection && collection.collection.length > 0) {
      return { customerNumber: collection.collection[0].customerNumber };
    }
  }

  const create = await request(config, "POST", "/customers", {
    name: searchName,
    email: email || undefined,
    currency: "DKK",
    customerGroup: { customerGroupNumber: config.customerGroupNumber },
    vatZone: { vatZoneNumber: config.defaultVatZoneNumber },
    paymentTerms: { paymentTermsNumber: config.defaultPaymentTermsNumber },
  });

  if (!create.ok) {
    const err = create.data as { message?: string };
    throw new Error(`Failed to create customer: ${err?.message || create.status}`);
  }

  const customer = create.data as { customerNumber: number };
  return { customerNumber: customer.customerNumber };
}

export function createEconomicProvider(config: EconomicConfig): AccountingProvider {
  return {
    name: "e-conomic",

    async testConnection(): Promise<{ ok: boolean; message: string }> {
      try {
        const res = await request(config, "GET", "/self");
        if (res.ok) {
          const self = res.data as { application?: { name?: string }; agreementNumber?: number };
          return {
            ok: true,
            message: `Forbundet til e-conomic (aftale #${self.agreementNumber || "?"})`,
          };
        }
        const err = res.data as { message?: string };
        return { ok: false, message: err?.message || `HTTP ${res.status}` };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : "Ukendt fejl" };
      }
    },

    async syncInvoice(invoice: AccountingInvoice): Promise<SyncResult> {
      try {
        const customer = await findOrCreateCustomer(config, invoice.customerName, invoice.customerEmail);

        const lines = invoice.lines.map((line) => ({
          product: { productNumber: config.defaultProductNumber },
          description: line.description,
          quantity: line.quantity,
          unitNetPrice: line.unitPrice,
        }));

        const draft = await request(config, "POST", "/invoices/drafts", {
          date: invoice.periodEnd.toISOString().slice(0, 10),
          currency: invoice.currency,
          customer: { customerNumber: customer.customerNumber },
          paymentTerms: { paymentTermsNumber: config.defaultPaymentTermsNumber },
          layout: { layoutNumber: 1 },
          lines,
          notes: {
            heading: `${invoice.unitName} — ${invoice.periodStart.toISOString().slice(0, 10)} til ${invoice.periodEnd.toISOString().slice(0, 10)}`,
          },
        });

        if (!draft.ok) {
          const err = draft.data as { message?: string; errors?: { propertyName?: string; errorMessage?: string }[] };
          const detail = err?.errors?.map((e) => `${e.propertyName}: ${e.errorMessage}`).join(", ") || err?.message;
          return { ok: false, error: `Kunne ikke oprette kladde: ${detail || draft.status}` };
        }

        const draftData = draft.data as { draftInvoiceNumber: number };
        const draftNumber = draftData.draftInvoiceNumber;

        const book = await request(config, "POST", "/invoices/booked", {
          draftInvoice: { draftInvoiceNumber: draftNumber },
        });

        if (!book.ok) {
          logger.warn("accounting", "Draft created but booking failed", { draftNumber, bookResponse: book.data });
          return { ok: true, externalId: `draft-${draftNumber}`, error: "Kladde oprettet men ikke bogført" };
        }

        const booked = book.data as { bookedInvoiceNumber: number };
        return { ok: true, externalId: String(booked.bookedInvoiceNumber) };
      } catch (e) {
        logger.error("accounting", "e-conomic syncInvoice error", e);
        return { ok: false, error: e instanceof Error ? e.message : "Ukendt fejl" };
      }
    },

    async syncPayment(payment: AccountingPayment): Promise<SyncResult> {
      try {
        logger.info("accounting", "Payment sync recorded (manual entry in e-conomic)", {
          internalId: payment.internalId,
          amount: payment.amount,
          paidAt: payment.paidAt,
        });
        return {
          ok: true,
          externalId: payment.paymentId || undefined,
          error: "Betalinger registreres manuelt i e-conomic eller via bank-integration",
        };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Ukendt fejl" };
      }
    },
  };
}
