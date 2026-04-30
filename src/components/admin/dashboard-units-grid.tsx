"use client";

import { useState, useTransition } from "react";
import {
  Home, Building2, Caravan, MapPin, Tent, BedDouble, Anchor,
  GripVertical, Pencil, Check, ArrowRightLeft, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { UnitCard } from "@/components/admin/cabin-card";
import { reorderUnits, moveUnitToResourceType } from "@/lib/actions";

type LucideIcon = typeof Home;
const ICONS: Record<string, LucideIcon> = {
  Home, Building2, Caravan, MapPin, Tent, BedDouble, Anchor,
};

interface UnitData {
  unit: {
    id: number;
    name: string;
    type: string;
    status: string;
    isLongTerm: boolean;
    longTermGuestName: string | null;
    resourceTypeId: number | null;
    sortOrder: number;
    hardware: {
      hasElectricity: boolean;
      hasWater: boolean;
      hasClimate: boolean;
      hasSmartLock: boolean;
    } | null;
  };
  haStates: {
    powerOn: boolean | null;
    temperature: number | null;
    locked: boolean | null;
    haReachable: boolean;
  } | null;
  activeGuestName: string | null;
}

interface ResourceTypeInfo {
  id: number;
  name: string;
  icon: string;
}

interface Props {
  unitData: UnitData[];
  resourceTypes: ResourceTypeInfo[];
}

export function DashboardUnitsGrid({ unitData: initialUnitData, resourceTypes }: Props) {
  const [unitData, setUnitData] = useState(initialUnitData);
  const [editMode, setEditMode] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const [movingUnitId, setMovingUnitId] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);

  const grouped = resourceTypes.map((rt) => ({
    rt,
    items: unitData
      .filter((d) => d.unit.resourceTypeId === rt.id)
      .sort((a, b) => a.unit.sortOrder - b.unit.sortOrder),
  }));
  const uncategorized = unitData
    .filter((d) => !d.unit.resourceTypeId)
    .sort((a, b) => a.unit.sortOrder - b.unit.sortOrder);

  function handleDragStart(unitId: number) {
    setDragId(unitId);
  }

  function handleDragEnd() {
    setDragId(null);
    setDragOverId(null);
  }

  function handleDragOver(e: React.DragEvent, unitId: number) {
    e.preventDefault();
    setDragOverId(unitId);
  }

  function handleDrop(targetUnitId: number) {
    if (dragId === null || dragId === targetUnitId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }

    const draggedUnit = unitData.find((d) => d.unit.id === dragId);
    const targetUnit = unitData.find((d) => d.unit.id === targetUnitId);
    if (!draggedUnit || !targetUnit) return;

    // Only reorder within the same resource type
    if (draggedUnit.unit.resourceTypeId !== targetUnit.unit.resourceTypeId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }

    const rtId = draggedUnit.unit.resourceTypeId;
    const sameTypeUnits = unitData
      .filter((d) => d.unit.resourceTypeId === rtId)
      .sort((a, b) => a.unit.sortOrder - b.unit.sortOrder);
    const fromIdx = sameTypeUnits.findIndex((d) => d.unit.id === dragId);
    const toIdx = sameTypeUnits.findIndex((d) => d.unit.id === targetUnitId);
    if (fromIdx === -1 || toIdx === -1) return;

    const reordered = [...sameTypeUnits];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    const newUnitData = unitData.map((d) => {
      if (d.unit.resourceTypeId !== rtId) return d;
      const idx = reordered.findIndex((r) => r.unit.id === d.unit.id);
      return idx >= 0 ? { ...d, unit: { ...d.unit, sortOrder: idx } } : d;
    });
    setUnitData(newUnitData);
    setDragId(null);
    setDragOverId(null);

    setPending(true);
    startTransition(async () => {
      try {
        await reorderUnits(rtId, reordered.map((d) => d.unit.id));
      } finally {
        setPending(false);
      }
    });
  }

  function handleMoveUnit(unitId: number, newResourceTypeId: number | null) {
    setMovingUnitId(unitId);
    setUnitData((prev) =>
      prev.map((d) =>
        d.unit.id === unitId
          ? { ...d, unit: { ...d.unit, resourceTypeId: newResourceTypeId } }
          : d,
      ),
    );
    startTransition(async () => {
      try {
        await moveUnitToResourceType(unitId, newResourceTypeId);
      } finally {
        setMovingUnitId(null);
      }
    });
  }

  return (
    <div className="space-y-8">
      {unitData.length > 0 && (
        <div className="flex items-center justify-end gap-2">
          {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Button
            variant={editMode ? "default" : "outline"}
            size="sm"
            onClick={() => setEditMode(!editMode)}
          >
            {editMode ? <Check className="h-4 w-4 mr-1.5" /> : <Pencil className="h-4 w-4 mr-1.5" />}
            {editMode ? "Færdig" : "Redigér rækkefølge"}
          </Button>
        </div>
      )}

      {grouped.filter((g) => g.items.length > 0).map((group) => {
        const Icon = ICONS[group.rt.icon] || Home;
        return (
          <section key={group.rt.id}>
            <div className="flex items-center gap-2.5 mb-4">
              <Icon className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">{group.rt.name}</h2>
              <span className="text-sm text-muted-foreground">({group.items.length})</span>
            </div>
            <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
              {group.items.map(({ unit, haStates, activeGuestName }) => (
                <DraggableUnitCard
                  key={unit.id}
                  unit={unit}
                  haStates={haStates}
                  activeGuestName={activeGuestName}
                  editMode={editMode}
                  isDragging={dragId === unit.id}
                  isDragOver={dragOverId === unit.id}
                  resourceTypes={resourceTypes}
                  onDragStart={() => handleDragStart(unit.id)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, unit.id)}
                  onDrop={() => handleDrop(unit.id)}
                  onMove={(newRtId) => handleMoveUnit(unit.id, newRtId)}
                  isMoving={movingUnitId === unit.id}
                />
              ))}
            </div>
          </section>
        );
      })}

      {uncategorized.length > 0 && (
        <section>
          <div className="flex items-center gap-2.5 mb-4">
            <h2 className="text-lg font-semibold text-muted-foreground">Ukategoriseret</h2>
            <span className="text-sm text-muted-foreground">({uncategorized.length})</span>
          </div>
          <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {uncategorized.map(({ unit, haStates, activeGuestName }) => (
              <DraggableUnitCard
                key={unit.id}
                unit={unit}
                haStates={haStates}
                activeGuestName={activeGuestName}
                editMode={editMode}
                isDragging={false}
                isDragOver={false}
                resourceTypes={resourceTypes}
                onDragStart={() => {}}
                onDragEnd={() => {}}
                onDragOver={() => {}}
                onDrop={() => {}}
                onMove={(newRtId) => handleMoveUnit(unit.id, newRtId)}
                isMoving={movingUnitId === unit.id}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

interface DraggableUnitCardProps {
  unit: UnitData["unit"];
  haStates: UnitData["haStates"];
  activeGuestName: string | null;
  editMode: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  resourceTypes: ResourceTypeInfo[];
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onMove: (newResourceTypeId: number | null) => void;
  isMoving: boolean;
}

function DraggableUnitCard({
  unit, haStates, activeGuestName, editMode, isDragging, isDragOver,
  resourceTypes, onDragStart, onDragEnd, onDragOver, onDrop, onMove, isMoving,
}: DraggableUnitCardProps) {
  const [showMoveMenu, setShowMoveMenu] = useState(false);

  return (
    <div
      draggable={editMode}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`relative ${isDragging ? "opacity-40" : ""} ${
        isDragOver ? "outline outline-2 outline-primary outline-offset-2 rounded-xl" : ""
      } ${editMode ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      {editMode && (
        <>
          <div className="absolute top-2 left-2 z-10 h-7 w-7 rounded-md bg-background/95 border border-border shadow-sm flex items-center justify-center pointer-events-none">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowMoveMenu(!showMoveMenu);
            }}
            className="absolute top-2 right-2 z-10 h-7 w-7 rounded-md bg-background/95 border border-border shadow-sm flex items-center justify-center hover:bg-muted"
            title="Flyt til anden ressourcetype"
          >
            {isMoving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
          {showMoveMenu && (
            <div className="absolute top-10 right-2 z-20 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[180px]">
              <p className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border">Flyt til:</p>
              {resourceTypes
                .filter((rt) => rt.id !== unit.resourceTypeId)
                .map((rt) => (
                  <button
                    key={rt.id}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowMoveMenu(false);
                      onMove(rt.id);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                  >
                    {rt.name}
                  </button>
                ))}
            </div>
          )}
        </>
      )}
      {editMode ? (
        <div onClick={(e) => e.preventDefault()}>
          <div style={{ pointerEvents: "none" }}>
            <UnitCard unit={unit} haStates={haStates} activeGuestName={activeGuestName} />
          </div>
        </div>
      ) : (
        <UnitCard unit={unit} haStates={haStates} activeGuestName={activeGuestName} />
      )}
    </div>
  );
}
