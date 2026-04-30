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

export interface BookingProvider {
  name: string;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
  getResourceTypes(): Promise<BookingResourceType[]>;
  getResources(typeId: string): Promise<BookingResource[]>;
}

export interface BookingLoginResult {
  success: boolean;
  needs2FA: boolean;
  sessionToken?: string;
  error?: string;
}

export interface BookingVerifyResult {
  success: boolean;
  sessionToken?: string;
  error?: string;
}
