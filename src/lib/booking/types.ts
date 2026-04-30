export interface BookingResource {
  externalId: string;
  name: string;
  typeId: string;
  typeName: string;
}

export interface BookingResourceType {
  id: string;
  name: string;
}

export interface BookingEntry {
  externalBookingId: string;
  externalCustomerId: string;
  bookingNumber: string;
  unitName: string;
  customerName: string;
  guestNames: string;
  email: string;
  phone: string;
  language: string;
  country: string;
  checkIn: string;   // YYYY-MM-DD
  checkOut: string;  // YYYY-MM-DD
}

export interface BookingProvider {
  name: string;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
  getResourceTypes(): Promise<BookingResourceType[]>;
  getResources(typeId: string): Promise<BookingResource[]>;
  getBookings(productType?: "all" | "tourist" | "seasonal"): Promise<BookingEntry[]>;
}

export interface BookingLoginResult {
  success: boolean;
  needs2FA: boolean;
  sessionToken?: string;
  approveFormData?: Record<string, string>;
  approveFormAction?: string;
  error?: string;
}

export interface BookingVerifyResult {
  success: boolean;
  sessionToken?: string;
  error?: string;
}
