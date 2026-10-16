// The CampSense MCP server: a fresh, stateless McpServer per HTTP request
// (see src/app/api/mcp/route.ts) exposing read-only inspection tools.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpToolContext } from "@/lib/mcp/tools/common";
import { registerSystemTools } from "@/lib/mcp/tools/system";
import { registerLogTools } from "@/lib/mcp/tools/logs";
import { registerUnitTools } from "@/lib/mcp/tools/units";
import { registerDeviceTools } from "@/lib/mcp/tools/devices";
import { registerBookingTools } from "@/lib/mcp/tools/bookings";
import { registerServiceTools } from "@/lib/mcp/tools/services";

const INSTRUCTIONS = `CampSense is the management system of a Danish campsite (UI language Danish). All tools are READ-ONLY: they never switch relays, change bookings or write data.

Data model:
- Units (pladser): hytte/CABIN, plads/PITCH, campingvogn/CARAVAN, fastligger/SEASONAL (long-term tenant, monthly invoices). Each unit may have hardware: electricity relay + kWh meter + power sensor, heating relay/meter, water meter, thermostat, smart lock — read via Home Assistant (HA) or directly from Shelly devices over MQTT.
- Sessions (ophold/bookings): PENDING = reservation (often imported from the Danplanner booking system), ACTIVE = checked in, COMPLETED = checked out. A PENDING booking whose planned checkout day has passed without check-in is an EXPIRED reservation, not "reserved" (state EXPIRED_RESERVATION).
- Billing: a cron ticks every 10 minutes, reading meters and adding delta x current price to the session's accumulated electricity/water cost. Pricing mode is fixed, minimum (max of fixed and spot) or spot (+ surcharge). POSTPAID stays pay at checkout; PREPAID stays draw on a deposited balance.
- ConsumptionLog: cumulative meter readings per unit every ~10 minutes (used for history/charts).
- Services: laundry machines (fixed price or metered per minute) and showers (paid per minute), bought by guests by card or on their stay.

Tips: start with get_system_status; use list_units / list_sessions to find ids; read_unit_meters, list_mqtt_devices and get_shelly_status query live hardware and can take a few seconds. Timestamps are ISO 8601 (UTC) unless a field says DK/local; the site is in Europe/Copenhagen. Amounts are DKK. Guest e-mail/phone are masked and secrets are never returned.`;

export function createCampSenseMcpServer(ctx: McpToolContext = {}): McpServer {
  const server = new McpServer({ name: "campsense", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  registerSystemTools(server, ctx);
  registerUnitTools(server);
  registerBookingTools(server);
  registerServiceTools(server);
  registerDeviceTools(server);
  registerLogTools(server);
  return server;
}
