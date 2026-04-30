"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Home, Building2, Caravan, MapPin, Tent, BedDouble, Anchor, GripVertical, X, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateUnitMapPosition } from "@/lib/actions";
import Link from "next/link";

interface MapUnit {
  id: number;
  name: string;
  type: string;
  status: string;
  isLongTerm: boolean;
  longTermGuestName: string | null;
  externalId: string | null;
  mapX: number | null;
  mapY: number | null;
  resourceTypeId: number | null;
  resourceTypeIcon: string | null;
  resourceTypeName: string | null;
  powerOn: boolean | null;
  haReachable: boolean;
  activeGuestName: string | null;
  hasElectricity: boolean;
}

interface SiteMapEditorProps {
  units: MapUnit[];
  siteMapUrl: string | null;
}

type LucideIcon = typeof Home;
const ICONS: Record<string, LucideIcon> = {
  Home, Building2, Caravan, MapPin, Tent, BedDouble, Anchor,
};

const typeLabels: Record<string, string> = {
  CABIN: "Hytte",
  SEASONAL: "Fastligger",
  CARAVAN: "Campingvogn",
  PITCH: "Plads",
};

function getMarkerColor(unit: MapUnit): string {
  const isOccupied = unit.status === "OCCUPIED" || unit.activeGuestName || unit.longTermGuestName;

  if (!unit.hasElectricity) {
    return isOccupied ? "bg-blue-500 border-blue-600" : "bg-gray-400 border-gray-500";
  }

  if (unit.powerOn === true) {
    return isOccupied
      ? "bg-green-500 border-green-600"
      : "bg-amber-400 border-amber-500";
  }

  if (unit.powerOn === false) {
    return isOccupied
      ? "bg-red-500 border-red-600"
      : "bg-gray-400 border-gray-500";
  }

  return isOccupied ? "bg-blue-500 border-blue-600" : "bg-gray-300 border-gray-400";
}

/** Pick a shape for the marker so the user can tell pitches from cabins at a glance. */
function getMarkerShape(unit: MapUnit): string {
  // Pitches stay as circles. Other resource types get rounded squares to differentiate.
  if (!unit.resourceTypeIcon || unit.resourceTypeIcon === "MapPin") {
    return "rounded-full";
  }
  return "rounded-md";
}

/** Extract a short label for inside the marker — last digit sequence in the name, falling back to first 2 chars. */
function getMarkerLabel(name: string): string {
  const trimmed = name.trim();
  const numMatch = trimmed.match(/(\d+)(?:[^\d]*)?$/);
  if (numMatch) return numMatch[1];
  return trimmed.slice(0, 3);
}

function getMarkerTooltip(unit: MapUnit): string {
  const parts = [unit.name];
  const guest = unit.activeGuestName || unit.longTermGuestName;
  if (guest) parts.push(guest);
  if (unit.hasElectricity) {
    if (unit.powerOn === true) parts.push("Strøm: TIL");
    else if (unit.powerOn === false) parts.push("Strøm: FRA");
    else parts.push("Strøm: Ukendt");
  }
  return parts.join(" — ");
}

export function SiteMapEditor({ units, siteMapUrl }: SiteMapEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [editMode, setEditMode] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [positions, setPositions] = useState<Record<number, { x: number; y: number }>>(() => {
    const pos: Record<number, { x: number; y: number }> = {};
    for (const u of units) {
      if (u.mapX !== null && u.mapY !== null) {
        pos[u.id] = { x: u.mapX, y: u.mapY };
      }
    }
    return pos;
  });
  const [saving, setSaving] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<number | null>(null);
  const [dirty, setDirty] = useState(new Set<number>());

  const placedIds = new Set(Object.keys(positions).map(Number));
  const unplacedUnits = units.filter((u) => !placedIds.has(u.id));

  const getRelativePos = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return { x: 50, y: 50 };
    const rect = el.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    return {
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y)),
    };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent, unitId: number) => {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(unitId);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [editMode]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragging === null) return;
    const pos = getRelativePos(e.clientX, e.clientY);
    setPositions((prev) => ({ ...prev, [dragging]: pos }));
    setDirty((prev) => new Set(prev).add(dragging));
  }, [dragging, getRelativePos]);

  const handlePointerUp = useCallback(() => {
    setDragging(null);
  }, []);

  const handleMapClick = useCallback((e: React.MouseEvent) => {
    if (!editMode || dragging !== null) return;
    if (selectedUnit !== null) {
      const pos = getRelativePos(e.clientX, e.clientY);
      setPositions((prev) => ({ ...prev, [selectedUnit]: pos }));
      setDirty((prev) => new Set(prev).add(selectedUnit));
      setSelectedUnit(null);
    }
  }, [editMode, dragging, selectedUnit, getRelativePos]);

  const handleRemoveFromMap = useCallback((unitId: number) => {
    setPositions((prev) => {
      const next = { ...prev };
      delete next[unitId];
      return next;
    });
    setDirty((prev) => new Set(prev).add(unitId));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const dirtyIds = Array.from(dirty);
      for (const id of dirtyIds) {
        const pos = positions[id];
        if (pos) {
          await updateUnitMapPosition(id, pos.x, pos.y);
        } else {
          await updateUnitMapPosition(id, -1, -1);
        }
      }
      setDirty(new Set());
    } catch {
      // ignore
    }
    setSaving(false);
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedUnit(null);
        setDragging(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!siteMapUrl) {
    return (
      <div className="border-2 border-dashed rounded-xl p-12 text-center text-muted-foreground">
        <MapPin className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="text-lg font-medium mb-1">Intet pladskort uploadet</p>
        <p className="text-sm">
          Upload et pladskort under{" "}
          <Link href="/admin/settings" className="text-primary hover:underline">
            Indstillinger → Gæsteportal
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={editMode ? "default" : "outline"}
          size="sm"
          onClick={() => { setEditMode(!editMode); setSelectedUnit(null); }}
        >
          <GripVertical className="h-4 w-4 mr-2" />
          {editMode ? "Redigerer..." : "Placer enheder"}
        </Button>
        {editMode && dirty.size > 0 && (
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            {saving ? "Gemmer..." : `Gem (${dirty.size})`}
          </Button>
        )}

        {/* Legend */}
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-green-500" />
            Optaget + strøm
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-amber-400" />
            Ledig + strøm
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-red-500" />
            Optaget, ingen strøm
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-gray-400" />
            Ledig
          </span>
          <span className="hidden sm:inline-block w-px h-4 bg-border" />
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full border-2 border-muted-foreground" />
            Plads
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-md border-2 border-muted-foreground" />
            Hytte/Lejlighed
          </span>
        </div>
      </div>

      {/* Map container */}
      <div className="flex gap-4">
        <div
          ref={containerRef}
          className={`relative flex-1 rounded-xl border border-border shadow-sm ${editMode ? "cursor-crosshair" : ""}`}
          onClick={handleMapClick}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={siteMapUrl}
            alt="Pladskort"
            className="w-full h-auto block select-none pointer-events-none rounded-xl"
            draggable={false}
          />

          {/* Unit markers */}
          {Object.entries(positions).map(([idStr, pos]) => {
            const id = Number(idStr);
            const unit = units.find((u) => u.id === id);
            if (!unit) return null;

            const color = getMarkerColor(unit);
            const shape = getMarkerShape(unit);
            const label = getMarkerLabel(unit.name);
            const tooltip = getMarkerTooltip(unit);
            const guest = unit.activeGuestName || unit.longTermGuestName;
            const labelLength = label.length;
            const fontSize = labelLength <= 2 ? "text-[10px]" : labelLength === 3 ? "text-[9px]" : "text-[8px]";

            return (
              <div
                key={id}
                className={`absolute transform -translate-x-1/2 -translate-y-1/2 group z-10 hover:z-50 ${editMode ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
                style={{ left: `${pos.x}%`, top: `${pos.y}%`, zIndex: dragging === id ? 60 : undefined }}
                title={tooltip}
                onPointerDown={(e) => handlePointerDown(e, id)}
              >
                {/* Marker dot */}
                <div className={`relative h-6 w-6 ${shape} border-2 ${color} flex items-center justify-center text-white shadow-md transition-transform hover:scale-150`}>
                  <span className={`font-bold tabular-nums leading-none ${fontSize}`}>{label}</span>
                </div>

                {/* Hover tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block pointer-events-none">
                  <div className="bg-popover text-popover-foreground text-xs rounded-lg shadow-lg border border-border px-3 py-2 whitespace-nowrap">
                    <p className="font-medium">{unit.name}</p>
                    {unit.resourceTypeName && (
                      <p className="text-muted-foreground">{unit.resourceTypeName}</p>
                    )}
                    {guest && <p className="text-foreground/80">{guest}</p>}
                    {unit.hasElectricity && (
                      <p className={unit.powerOn ? "text-green-600" : "text-red-500"}>
                        {unit.powerOn ? "Strøm: TIL" : "Strøm: FRA"}
                      </p>
                    )}
                    {!unit.resourceTypeName && (
                      <p className="text-muted-foreground">{typeLabels[unit.type] || unit.type}</p>
                    )}
                  </div>
                </div>

                {/* Remove button in edit mode */}
                {editMode && (
                  <button
                    className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); handleRemoveFromMap(id); }}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Sidebar: unplaced units (edit mode only) */}
        {editMode && unplacedUnits.length > 0 && (
          <div className="w-56 shrink-0">
            <h3 className="text-sm font-medium mb-2">Ikke placeret</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Klik en enhed, derefter klik på kortet for at placere den.
            </p>
            <div className="space-y-1 max-h-[600px] overflow-y-auto">
              {unplacedUnits.map((unit) => {
                const Icon = (unit.resourceTypeIcon && ICONS[unit.resourceTypeIcon]) || MapPin;
                const isSelected = selectedUnit === unit.id;
                return (
                  <button
                    key={unit.id}
                    onClick={() => setSelectedUnit(isSelected ? null : unit.id)}
                    className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                      isSelected
                        ? "bg-primary text-white"
                        : "bg-muted/50 hover:bg-muted"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{unit.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Non-edit mode: unit list below map */}
      {!editMode && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {units.filter((u) => positions[u.id]).map((unit) => {
            const color = getMarkerColor(unit);
            const guest = unit.activeGuestName || unit.longTermGuestName;
            return (
              <Link
                key={unit.id}
                href={`/admin/units/${unit.id}`}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/60 hover:bg-muted/50 transition-colors"
              >
                <span className={`h-3 w-3 rounded-full ${color} shrink-0`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{unit.name}</p>
                  {guest && <p className="text-xs text-muted-foreground truncate">{guest}</p>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
