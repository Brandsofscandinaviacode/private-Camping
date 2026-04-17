import type { AccountingProvider } from "./types";
import { createEconomicProvider } from "./economic";

export type { AccountingProvider, AccountingInvoice, AccountingInvoiceLine, AccountingPayment, SyncResult } from "./types";

export type AccountingProviderType = "economic" | "none";

export function getAccountingProvider(
  provider: AccountingProviderType,
  settings: Record<string, string>,
): AccountingProvider | null {
  switch (provider) {
    case "economic":
      return createEconomicProvider({
        appSecretToken: settings.economic_app_secret_token || "",
        agreementGrantToken: settings.economic_agreement_grant_token || "",
        defaultPaymentTermsNumber: parseInt(settings.economic_payment_terms_number || "1", 10),
        defaultProductNumber: parseInt(settings.economic_product_number || "1", 10),
        defaultVatZoneNumber: parseInt(settings.economic_vat_zone_number || "1", 10),
        customerGroupNumber: parseInt(settings.economic_customer_group_number || "1", 10),
      });
    case "none":
    default:
      return null;
  }
}
