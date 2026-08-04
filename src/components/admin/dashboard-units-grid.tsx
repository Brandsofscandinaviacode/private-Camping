"use client";

import { useState, useTransition, useCallback, useEffect, useMemo } from "react";
import {
  Home, Building2, Caravan, MapPin, Tent, BedDouble, Anchor,
  GripVertical, Pencil, Check, ArrowRightLeft, Loader2,
  ChevronDown, LayoutGrid, List, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { UnitCard, UnitRow, STATUS, statusKey, type UnitStatusKey } from "@/components/admin/cabin-card";
import { reorderUnits, moveUnitToResourceType } from "@/lib/actions";

type LucideIcon = typeof Home;
const ICONS: Record<string, LucideIcon> = { Home, Building2, Caravan, MapPin, Tent, BedDouble, Anchor };

interface UnitData {
  unit: {
    id: number; name: string; type: string; status: string;
    isLongTerm: boolean; longTermGuestName: string | null;
    resourceTypeId: number | null; sortOrder: number;
    hardware: { hasElectricity: boolean; hasWater: boolean; hasClimate: boolean; hasSmartLock: boolean } | null;
  };
  haStates: { powerOn: boolean | null; temperature: number | null; locked: boolean | null; haReachable: boolean } | null;
  activeGuestName: string | null;
  pendingGuestName: string | null;
  activeCheckOut?: string | null;
  pendingCheckIn?: string | null;
}

interface ResourceTypeInfo { id: number; name: string; icon: string }
interface Props { unitData: UnitData[]; resourceTypes: ResourceTypeInfo[] }

type ViewMode = "list" | "cards";
type Filter = "all" | UnitStatusKey;

function usePersistedState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : initial; } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } }, [key, value]);
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

  // New storage key: the old one held "normal"/"compact", which no longer map.
  const [viewMode, setViewMode] = usePersistedState<ViewMode>("dashboard-view-mode", "list");
  const [collapsed, setCollapsed] = usePersistedState<Record<string, boolean>>("dashboard-collapsed", {});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const toggleCollapsed = useCallback((k: string) => {
    setCollapsed((prev: Record<string, boolean>) => ({ ...prev, [k]: !prev[k] }));
  }, [setCollapsed]);

  const q = query.trim().toLowerCase();
  const filtering = q.length > 0 || filter !== "all";

  const matches = useCallback((d: UnitData) => {
    const st = statusKey(d.unit.status, d.pendingGuestName);
    if (filter !== "all" && st !== filter) return false;
    if (q) {
      const hay = `${d.unit.name} ${d.activeGuestName || d.pendingGuestName || d.unit.longTermGuestName || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }, [filter, q]);

  const grouped = useMemo(() => resourceTypes.map((rt) => ({
    rt,
    all: unitData.filter((d) => d.unit.resourceTypeId === rt.id).sort((a, b) => a.unit.sortOrder - b.unit.sortOrder),
  })), [resourceTypes, unitData]);
  const uncategorized = unitData.filter((d) => !d.unit.resourceTypeId).sort((a, b) => a.unit.sortOrder - b.unit.sortOrder);

  // ---- drag / move handlers (unchanged behaviour) ----
  function handleDragStart(id: number) { setDragId(id); }
  function handleDragEnd() { setDragId(null); setDragOverId(null); }
  function handleDragOver(e: React.DragEvent, id: number) { e.preventDefault(); setDragOverId(id); }
  function handleDrop(targetId: number) {
    if (dragId === null || dragId === targetId) { setDragId(null); setDragOverId(null); return; }
    const dragged = unitData.find((d) => d.unit.id === dragId);
    const target = unitData.find((d) => d.unit.id === targetId);
    if (!dragged || !target || dragged.unit.resourceTypeId !== target.unit.resourceTypeId) { setDragId(null); setDragOverId(null); return; }
    const rtId = dragged.unit.resourceTypeId;
    const same = unitData.filter((d) => d.unit.resourceTypeId === rtId).sort((a, b) => a.unit.sortOrder - b.unit.sortOrder);
    const fromIdx = same.findIndex((d) => d.unit.id === dragId);
    const toIdx = same.findIndex((d) => d.unit.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = [...same];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    setUnitData(unitData.map((d) => {
      if (d.unit.resourceTypeId !== rtId) return d;
      const idx = reordered.findIndex((r) => r.unit.id === d.unit.id);
      return idx >= 0 ? { ...d, unit: { ...d.unit, sortOrder: idx } } : d;
    }));
    setDragId(null); setDragOverId(null); setPending(true);
    startTransition(async () => { try { await reorderUnits(rtId, reordered.map((d) => d.unit.id)); } finally { setPending(false); } });
  }
  function handleMoveUnit(id: number, newRtId: number | null) {
    setMovingUnitId(id);
    setUnitData((prev) => prev.map((d) => d.unit.id === id ? { ...d, unit: { ...d.unit, resourceTypeId: newRtId } } : d));
    startTransition(async () => { try { await moveUnitToResourceType(id, newRtId); } finally { setMovingUnitId(null); } });
  }

  function renderGroupStats(items: UnitData[]) {
    const occupied = items.filter((d) => d.unit.status === "OCCUPIED").length;
    const reserved = items.filter((d) => d.unit.status !== "OCCUPIED" && !!d.pendingGuestName).length;
    const vacant = items.length - occupied - reserved;
    const pct = items.length ? (occupied / items.length) * 100 : 0;
    const resPct = items.length ? (reserved / items.length) * 100 : 0;
    return (
      <div className="flex items-center gap-3">
        <div className="hidden md:flex w-[120px] h-1.5 rounded-full bg-muted overflow-hidden">
          <span className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
          <span className="h-full bg-amber-500" style={{ width: `${resPct}%` }} />
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          {occupied > 0 && <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full ${STATUS.occ.soft} ${STATUS.occ.text} font-semibold`}><span className={`h-1.5 w-1.5 rounded-full ${STATUS.occ.dot}`} />{occupied}</span>}
          {reserved > 0 && <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full ${STATUS.res.soft} ${STATUS.res.text} font-semibold`}><span className={`h-1.5 w-1.5 rounded-full ${STATUS.res.dot}`} />{reserved}</span>}
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-semibold"><span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />{vacant}</span>
        </div>
      </div>
    );
  }

  function renderCards(items: UnitData[]) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5">
        {items.map((d) => (
          <DraggableUnitCard key={d.unit.id} data={d} editMode={editMode} resourceTypes={resourceTypes}
            isDragging={dragId === d.unit.id} isDragOver={dragOverId === d.unit.id}
            onDragStart={() => handleDragStart(d.unit.id)} onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, d.unit.id)} onDrop={() => handleDrop(d.unit.id)}
            onMove={(rt) => handleMoveUnit(d.unit.id, rt)} isMoving={movingUnitId === d.unit.id} />
        ))}
      </div>
    );
  }

  function renderTable(items: UnitData[]) {
    return (
      <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
        <div className="grid grid-cols-[1.4fr_1fr_1.6fr_1fr_auto] gap-3 px-4 py-2.5 bg-muted/40 border-b border-border text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Enhed</span><span>Status</span><span>Gæst</span><span>Afrejse</span><span />
        </div>
        {items.map((d) => (
          <UnitRow key={d.unit.id} type={d.unit.type} unit={d.unit} haStates={d.haStates}
            activeGuestName={d.activeGuestName} pendingGuestName={d.pendingGuestName}
            activeCheckOut={d.activeCheckOut} pendingCheckIn={d.pendingCheckIn} />
        ))}
      </div>
    );
  }

  function renderGroup(rt: ResourceTypeInfo | null, all: UnitData[], key: string) {
    const visible = filtering ? all.filter(matches) : all;
    if (filtering && visible.length === 0) return null;
    const Icon = rt ? (ICONS[rt.icon] || Home) : Home;
    const name = rt ? rt.name : "Ukategoriseret";
    const isCollapsed = collapsed[key] ?? false;
    // Every group renders the same way — the view toggle decides, not the unit
    // type. Edit mode always falls back to cards so drag-reorder still works.
    const asTable = !editMode && viewMode === "list";

    return (
      <section key={key}>
        <div className="flex items-center gap-2.5 mb-4">
          <button type="button" onClick={() => toggleCollapsed(key)} className="flex items-center gap-2.5 text-left hover:opacity-80 transition-opacity">
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
            {rt && <Icon className="h-5 w-5 text-muted-foreground" />}
            <h2 className={`text-lg font-semibold ${rt ? "" : "text-muted-foreground"}`}>{name}</h2>
            <span className="text-sm text-muted-foreground">
              ({filtering ? `${visible.length} / ${all.length}` : all.length})
            </span>
          </button>
          <div className="ml-auto">{renderGroupStats(all)}</div>
        </div>
        {!isCollapsed && (asTable ? renderTable(visible) : renderCards(visible))}
      </section>
    );
  }

  const anyVisible = grouped.some((g) => (filtering ? g.all.some(matches) : g.all.length > 0)) || (filtering ? uncategorized.some(matches) : uncategorized.length > 0);

  return (
    <div className="space-y-7">
      {/* Toolbar: search + filter chips + view toggle + edit */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-[360px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Søg enhed eller gæst…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-card text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {([["all", "Alle"], ["occ", "Optaget"], ["free", "Ledig"], ["res", "Reserveret"]] as const).map(([f, label]) => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={`text-[13px] font-medium px-3 py-2 rounded-lg border transition inline-flex items-center gap-1.5 ${
                filter === f ? "bg-foreground text-background border-foreground" : "bg-card text-muted-foreground border-border hover:border-foreground/20"
              }`}>
              {f !== "all" && <span className={`h-1.5 w-1.5 rounded-full ${STATUS[f as UnitStatusKey].dot}`} />}
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        <div className="flex items-center rounded-lg border border-border bg-muted/30 p-0.5">
          <button type="button" onClick={() => setViewMode("list")} title="Liste"
            className={`px-2.5 py-1.5 rounded-md transition ${viewMode === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            <List className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setViewMode("cards")} title="Kort"
            className={`px-2.5 py-1.5 rounded-md transition ${viewMode === "cards" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
        </div>
        <Button variant={editMode ? "default" : "outline"} size="sm" onClick={() => setEditMode(!editMode)}>
          {editMode ? <Check className="h-4 w-4 mr-1.5" /> : <Pencil className="h-4 w-4 mr-1.5" />}
          {editMode ? "Færdig" : "Redigér"}
        </Button>
      </div>

      {grouped.filter((g) => g.all.length > 0).map((g) => renderGroup(g.rt, g.all, `rt-${g.rt.id}`))}
      {uncategorized.length > 0 && renderGroup(null, uncategorized, "uncategorized")}

      {filtering && !anyVisible && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Search className="h-7 w-7 mb-3 opacity-40" />
          <p className="font-medium">Ingen enheder matcher</p>
          <button onClick={() => { setQuery(""); setFilter("all"); }} className="mt-2 text-sm text-primary font-medium">Ryd filtre</button>
        </div>
      )}
    </div>
  );
}

// ---- Draggable card wrapper (edit-mode reorder + move menu) ----
interface DraggableProps {
  data: UnitData; editMode: boolean; isDragging: boolean; isDragOver: boolean;
  resourceTypes: ResourceTypeInfo[];
  onDragStart: () => void; onDragEnd: () => void; onDragOver: (e: React.DragEvent) => void; onDrop: () => void;
  onMove: (newResourceTypeId: number | null) => void; isMoving: boolean;
}

function DraggableUnitCard({ data, editMode, isDragging, isDragOver, resourceTypes, onDragStart, onDragEnd, onDragOver, onDrop, onMove, isMoving }: DraggableProps) {
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const { unit, haStates, activeGuestName, pendingGuestName, activeCheckOut, pendingCheckIn } = data;

  return (
    <div draggable={editMode} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={onDragOver} onDrop={onDrop}
      className={`relative ${isDragging ? "opacity-40" : ""} ${isDragOver ? "outline outline-2 outline-primary outline-offset-2 rounded-xl" : ""} ${editMode ? "cursor-grab active:cursor-grabbing" : ""}`}>
      {editMode && (
        <>
          <div className="absolute top-2 left-2 z-10 h-7 w-7 rounded-md bg-background/95 border border-border shadow-sm flex items-center justify-center pointer-events-none">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>
          <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowMoveMenu(!showMoveMenu); }}
            className="absolute top-2 right-2 z-10 h-7 w-7 rounded-md bg-background/95 border border-border shadow-sm flex items-center justify-center hover:bg-muted" title="Flyt til anden ressourcetype">
            {isMoving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
          {showMoveMenu && (
            <div className="absolute top-10 right-2 z-20 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[180px]">
              <p className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border">Flyt til:</p>
              {resourceTypes.filter((rt) => rt.id !== unit.resourceTypeId).map((rt) => (
                <button key={rt.id} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowMoveMenu(false); onMove(rt.id); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted">{rt.name}</button>
              ))}
            </div>
          )}
        </>
      )}
      {editMode ? (
        <div onClick={(e) => e.preventDefault()}>
          <div style={{ pointerEvents: "none" }}>
            <UnitCard unit={unit} haStates={haStates} activeGuestName={activeGuestName} pendingGuestName={pendingGuestName} activeCheckOut={activeCheckOut} pendingCheckIn={pendingCheckIn} />
          </div>
        </div>
      ) : (
        <UnitCard unit={unit} haStates={haStates} activeGuestName={activeGuestName} pendingGuestName={pendingGuestName} activeCheckOut={activeCheckOut} pendingCheckIn={pendingCheckIn} />
      )}
    </div>
  );
}
