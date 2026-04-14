import { NextRequest, NextResponse } from "next/server";
import { authenticateAPI } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

// GET /api/v1/units — List all units
export async function GET(req: NextRequest) {
  const auth = await authenticateAPI(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const units = await prisma.unit.findMany({
    include: { hardware: true },
    orderBy: { id: "asc" },
  });

  return NextResponse.json({
    units: units.map((u) => ({
      id: u.id,
      name: u.name,
      type: u.type,
      status: u.status,
      isLongTerm: u.isLongTerm,
      longTermGuestName: u.longTermGuestName,
      longTermGuestEmail: u.longTermGuestEmail,
      longTermGuestPhone: u.longTermGuestPhone,
      longTermPortalToken: u.longTermPortalToken,
      hardware: u.hardware ? {
        hasElectricity: u.hardware.hasElectricity,
        hasHeating: u.hardware.hasHeating,
        winterModeEnabled: u.hardware.winterModeEnabled,
        hasWater: u.hardware.hasWater,
        hasClimate: u.hardware.hasClimate,
        hasSmartLock: u.hardware.hasSmartLock,
      } : null,
    })),
  });
}
