export interface AccountingInvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  unit?: string;
}

export interface AccountingInvoice {
  internalId: number;
  customerName: string;
  customerEmail?: string;
  unitName: string;
  periodStart: Date;
  periodEnd: Date;
  lines: AccountingInvoiceLine[];
  totalAmount: number;
  currency: string;
  paidAt?: Date;
  paymentId?: string;
}

export interface AccountingPayment {
  internalId: number;
  customerName: string;
  amount: number;
  currency: string;
  paidAt: Date;
  paymentId?: string;
  description: string;
}

export interface SyncResult {
  ok: boolean;
  externalId?: string;
  error?: string;
}

export interface AccountingProvider {
  name: string;
  testConnection(): Promise<{ ok: boolean; message: string }>;
  syncInvoice(invoice: AccountingInvoice): Promise<SyncResult>;
  syncPayment(payment: AccountingPayment): Promise<SyncResult>;
}
