"use client";

import { useState, useTransition, useCallback, useEffect } from "react";
import {
  Home, Building2, Caravan, MapPin, Tent, BedDouble, Anchor,
  GripVertical, Pencil, Check, ArrowRightLeft, Loader2,
  ChevronDown, LayoutGrid, List,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { UnitCard, UnitCardCompact } from "@/components/admin/cabin-card";
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
  pendingGuestName: string | null;
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

type ViewMode = "normal" | "compact";

function usePersistedState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch { /* ignore */ }
  }, [key, value]);

  return [value, setValue];
}

export function DashboardUnitsGrid({ unitData: initialUnitData, resourceTypes }: Props) {
  const [unitData, setUnitData] = useState(initialUnitData);
  const [editMode, setEditMode] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const [movingUnitId, setMovingUnitId] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);

  const [viewMode, setViewMode] = usePersistedState<ViewMode>("dashboard-view", "normal");
  const [collapsed, setCollapsed] = usePersistedState<Record<string, boolean>>("dashboard-collapsed", {});

  const toggleCollapsed = useCallback((groupKey: string) => {
    setCollapsed((prev: Record<string, boolean>) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  }, [setCollapsed]);

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

  function renderGroupStats(items: UnitData[]) {
    const occupied = items.filter((d) => d.unit.status === "OCCUPIED").length;
    const reserved = items.filter((d) => d.unit.status !== "OCCUPIED" && !!d.pendingGuestName).length;
    const vacant = items.length - occupied - reserved;

    return (
      <div className="flex items-center gap-2 text-xs">
        {occupied > 0 && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            {occupied}
          </span>
        )}
        {reserved > 0 && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            {reserved}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
          {vacant}
        </span>
      </div>
    );
  }

  function renderCards(items: UnitData[]) {
    if (viewMode === "compact") {
      return (
        <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
          {items.map(({ unit, haStates, activeGuestName, pendingGuestName }) =>
            editMode ? (
              <DraggableUnitCard
                key={unit.id}
                unit={unit}
                haStates={haStates}
                activeGuestName={activeGuestName}
                pendingGuestName={pendingGuestName}
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
                compact
              />
            ) : (
              <UnitCardCompact
                key={unit.id}
                unit={unit}
                activeGuestName={activeGuestName}
                pendingGuestName={pendingGuestName}
              />
            ),
          )}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
        {items.map(({ unit, haStates, activeGuestName, pendingGuestName }) => (
          <DraggableUnitCard
            key={unit.id}
            unit={unit}
            haStates={haStates}
            activeGuestName={activeGuestName}
            pendingGuestName={pendingGuestName}
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
    );
  }

  return (
    <div className="space-y-6">
      {unitData.length > 0 && (
        <div className="flex items-center justify-end gap-2">
          {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <div className="flex items-center rounded-lg border border-border bg-muted/30 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("normal")}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === "normal"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Normal visning"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("compact")}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === "compact"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Kompakt visning"
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
          <Button
            variant={editMode ? "default" : "outline"}
            size="sm"
            onClick={() => setEditMode(!editMode)}
          >
            {editMode ? <Check className="h-4 w-4 mr-1.5" /> : <Pencil className="h-4 w-4 mr-1.5" />}
            {editMode ? "Færdig" : "Redigér"}
          </Button>
        </div>
      )}

      {grouped.filter((g) => g.items.length > 0).map((group) => {
        const Icon = ICONS[group.rt.icon] || Home;
        const groupKey = `rt-${group.rt.id}`;
        const isCollapsed = collapsed[groupKey] ?? false;

        return (
          <section key={group.rt.id}>
            <button
              type="button"
              onClick={() => toggleCollapsed(groupKey)}
              className="flex items-center gap-2.5 mb-4 w-full text-left group/header hover:opacity-80 transition-opacity"
            >
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
              <Icon className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">{group.rt.name}</h2>
              <span className="text-sm text-muted-foreground">({group.items.length})</span>
              <div className="ml-auto">
                {renderGroupStats(group.items)}
              </div>
            </button>
            {!isCollapsed && renderCards(group.items)}
          </section>
        );
      })}

      {uncategorized.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => toggleCollapsed("uncategorized")}
            className="flex items-center gap-2.5 mb-4 w-full text-left group/header hover:opacity-80 transition-opacity"
          >
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${collapsed["uncategorized"] ? "-rotate-90" : ""}`} />
            <h2 className="text-lg font-semibold text-muted-foreground">Ukategoriseret</h2>
            <span className="text-sm text-muted-foreground">({uncategorized.length})</span>
            <div className="ml-auto">
              {renderGroupStats(uncategorized)}
            </div>
          </button>
          {!collapsed["uncategorized"] && renderCards(uncategorized)}
        </section>
      )}
    </div>
  );
}

interface DraggableUnitCardProps {
  unit: UnitData["unit"];
  haStates: UnitData["haStates"];
  activeGuestName: string | null;
  pendingGuestName: string | null;
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
  compact?: boolean;
}

function DraggableUnitCard({
  unit, haStates, activeGuestName, pendingGuestName, editMode, isDragging, isDragOver,
  resourceTypes, onDragStart, onDragEnd, onDragOver, onDrop, onMove, isMoving, compact,
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
            {compact ? (
              <UnitCardCompact unit={unit} activeGuestName={activeGuestName} pendingGuestName={pendingGuestName} />
            ) : (
              <UnitCard unit={unit} haStates={haStates} activeGuestName={activeGuestName} pendingGuestName={pendingGuestName} />
            )}
          </div>
        </div>
      ) : compact ? (
        <UnitCardCompact unit={unit} activeGuestName={activeGuestName} pendingGuestName={pendingGuestName} />
      ) : (
        <UnitCard unit={unit} haStates={haStates} activeGuestName={activeGuestName} pendingGuestName={pendingGuestName} />
      )}
    </div>
  );
}
