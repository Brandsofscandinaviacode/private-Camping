import { z } from "zod";

export const checkInSchema = z.object({
  unitId: z.number().int().positive(),
  guestName: z.string().min(1).max(200),
  guestEmail: z.string().email().max(200).optional().or(z.literal("")),
  guestPhone: z.string().max(30).optional().or(z.literal("")),
  bookingRef: z.string().max(50).optional().or(z.literal("")),
  expectedCheckOut: z.string().optional().or(z.literal("")),
  billingMode: z.enum(["PREPAID", "POSTPAID"]).optional(),
  prepaidAmount: z.number().min(0).optional(),
});

export const sessionIdSchema = z.number().int().positive();

export const unitIdSchema = z.number().int().positive();

export const adjustPrepaidSchema = z.object({
  sessionId: z.number().int().positive(),
  newAmount: z.number().min(0),
});

export const updateSessionSchema = z.object({
  sessionId: z.number().int().positive(),
  guestName: z.string().min(1).max(200).optional(),
  guestEmail: z.string().email().max(200).optional().nullable(),
  guestPhone: z.string().max(30).optional().nullable(),
  bookingRef: z.string().max(50).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  expectedCheckOut: z.string().optional().nullable(),
  pricePerKwhOverride: z.number().min(0).optional().nullable(),
  pricePerLiterWaterOverride: z.number().min(0).optional().nullable(),
  externalPrice: z.number().min(0).optional().nullable(),
  externalDescription: z.string().max(500).optional().nullable(),
});

export const createUnitSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["CABIN", "SEASONAL", "CARAVAN", "PITCH"]),
});

export const temperatureSchema = z.number().min(5).max(35);

export const settingsSchema = z.array(
  z.object({
    key: z.string().min(1).max(100),
    value: z.string().max(10000),
  }),
);

export const laundryMachineSchema = z.object({
  name: z.string().min(1).max(100),
  kind: z.enum(["WASHER", "DRYER"]).optional(),
  source: z.enum(["HA", "MQTT"]).optional(),
  switchEntityId: z.string().max(200).optional().nullable(),
  mqttPrefix: z.string().max(200).optional().nullable(),
  mqttComponent: z.string().max(100).optional().nullable(),
  durationMinutes: z.number().int().min(1).max(600).optional(),
  pricePerUse: z.number().min(0).optional(),
  enabled: z.boolean().optional(),
  code: z.string().max(10).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  groupId: z.number().int().positive().optional().nullable(),
});

export const showerSchema = z.object({
  name: z.string().min(1).max(100),
  source: z.enum(["HA", "MQTT"]).optional(),
  switchEntityId: z.string().max(200).optional().nullable(),
  mqttPrefix: z.string().max(200).optional().nullable(),
  mqttComponent: z.string().max(100).optional().nullable(),
  pricePerMinute: z.number().min(0).optional(),
  minMinutes: z.number().int().min(1).max(60).optional(),
  maxMinutes: z.number().int().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  code: z.string().max(10).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
});

export const portalTokenSchema = z.string().min(1).max(100);

export const showerPaymentSchema = z.object({
  showerId: z.number().int().positive(),
  durationMinutes: z.number().int().min(1).max(120),
  token: z.string().min(1).max(100),
});
