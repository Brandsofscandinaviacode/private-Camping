"use client";

import { useState, useTransition, useEffect, useMemo, useRef } from "react";
import { ChevronDown, ChevronRight, Save, Loader2, Search, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { updateUnitHardware, browseHAEntities, type BrowsableEntity, type EntityCategory } from "@/lib/actions";

const typeLabels: Record<string, string> = {
  CABIN: "Hytte",
  SEASONAL: "Fastligger",
  CARAVAN: "Campingvogn",
  PITCH: "Plads",
};

interface CabinHardwareFormProps {
  cabin: { id: number; name: string; type: string };
  hardware: {
    hasElectricity: boolean;
    electricitySource: string;
    electricitySwitchEntityId: string | null;
    electricityMeterEntityId: string | null;
    electricityPowerEntityId: string | null;
    electricityMqttPrefix: string | null;
    electricityMqttComponent: string | null;
    hasHeating: boolean;
    heatingSource: string;
    heatingSwitchEntityId: string | null;
    heatingMeterEntityId: string | null;
    heatingPowerEntityId: string | null;
    heatingMqttPrefix: string | null;
    heatingMqttComponent: string | null;
    winterModeEnabled: boolean;
    hasWater: boolean;
    waterSource: string;
    waterMeterEntityId: string | null;
    waterMqttPrefix: string | null;
    waterMqttComponent: string | null;
    hasClimate: boolean;
    climateEntityId: string | null;
    hasSmartLock: boolean;
    lockEntityId: string | null;
  } | null;
}

function SourceSelect({
  value,
  onChange,
}: {
  value: "HA" | "MQTT";
  onChange: (v: "HA" | "MQTT") => void;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">Hardware-kilde</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as "HA" | "MQTT")}
        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      >
        <option value="HA">Home Assistant</option>
        <option value="MQTT">MQTT (Shelly direkte)</option>
      </select>
    </div>
  );
}

// Entity picker with search and "used by" indicator
function EntityPicker({
  value,
  onChange,
  entities,
  loading,
  filterCategory,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  entities: BrowsableEntity[];
  loading: boolean;
  filterCategory?: EntityCategory[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const filtered = useMemo(() => {
    let list = entities;
    if (filterCategory?.length) {
      list = list.filter((e) => filterCategory.includes(e.category));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.entity_id.toLowerCase().includes(q) ||
          e.friendly_name.toLowerCase().includes(q)
      );
    }
    return list;
  }, [entities, filterCategory, search]);

  const selectedEntity = entities.find((e) => e.entity_id === value);

  return (
    <div className="relative" ref={ref}>
      <div
        className="flex items-center border rounded-md bg-background cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        <div className="flex-1 px-3 py-2 text-sm truncate">
          {value ? (
            <span>
              <span className="font-medium">{selectedEntity?.friendly_name || value}</span>
              <span className="text-muted-foreground ml-1.5 text-xs">({value})</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder || "Vælg entity..."}</span>
          )}
        </div>
        <div className="px-2 text-muted-foreground">
          <ChevronDown className="h-3.5 w-3.5" />
        </div>
      </div>

      {value && (
        <button
          type="button"
          className="absolute right-8 top-2.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={(e) => { e.stopPropagation(); onChange(""); }}
        >
          ✕
        </button>
      )}

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-background border rounded-md shadow-lg max-h-64 overflow-hidden">
          <div className="p-2 border-b">
            <div className="flex items-center gap-1.5 px-2 border rounded-md bg-muted/30">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Søg entity..."
                className="flex-1 py-1.5 text-sm bg-transparent outline-none"
                autoFocus
              />
            </div>
          </div>
          <div className="overflow-y-auto max-h-48">
            {loading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" />
                Henter entities fra HA...
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Ingen entities fundet
              </div>
            ) : (
              filtered.map((e) => (
                <button
                  key={e.entity_id}
                  type="button"
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors flex items-center justify-between ${
                    e.entity_id === value ? "bg-primary/5" : ""
                  }`}
                  onClick={() => {
                    onChange(e.entity_id);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{e.friendly_name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {e.entity_id} — {e.state}{e.unit_of_measurement ? ` ${e.unit_of_measurement}` : ""}
                    </div>
                  </div>
                  {e.usedBy && (
                    <span className="ml-2 flex-shrink-0 text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 whitespace-nowrap">
                      Brugt af: {e.usedBy}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function CabinHardwareForm({ cabin, hardware }: CabinHardwareFormProps) {
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [entities, setEntities] = useState<BrowsableEntity[]>([]);
  const [entitiesLoading, setEntitiesLoading] = useState(false);

  const [values, setValues] = useState({
    hasElectricity: hardware?.hasElectricity ?? false,
    electricitySource: (hardware?.electricitySource === "MQTT" ? "MQTT" : "HA") as "HA" | "MQTT",
    electricitySwitchEntityId: hardware?.electricitySwitchEntityId ?? "",
    electricityMeterEntityId: hardware?.electricityMeterEntityId ?? "",
    electricityPowerEntityId: hardware?.electricityPowerEntityId ?? "",
    electricityMqttPrefix: hardware?.electricityMqttPrefix ?? "",
    electricityMqttComponent: hardware?.electricityMqttComponent ?? "switch:0",
    hasHeating: hardware?.hasHeating ?? false,
    heatingSource: (hardware?.heatingSource === "MQTT" ? "MQTT" : "HA") as "HA" | "MQTT",
    heatingSwitchEntityId: hardware?.heatingSwitchEntityId ?? "",
    heatingMeterEntityId: hardware?.heatingMeterEntityId ?? "",
    heatingPowerEntityId: hardware?.heatingPowerEntityId ?? "",
    heatingMqttPrefix: hardware?.heatingMqttPrefix ?? "",
    heatingMqttComponent: hardware?.heatingMqttComponent ?? "switch:0",
    winterModeEnabled: hardware?.winterModeEnabled ?? false,
    hasWater: hardware?.hasWater ?? false,
    waterSource: (hardware?.waterSource === "MQTT" ? "MQTT" : "HA") as "HA" | "MQTT",
    waterMeterEntityId: hardware?.waterMeterEntityId ?? "",
    waterMqttPrefix: hardware?.waterMqttPrefix ?? "",
    waterMqttComponent: hardware?.waterMqttComponent ?? "",
    hasClimate: hardware?.hasClimate ?? false,
    climateEntityId: hardware?.climateEntityId ?? "",
    hasSmartLock: hardware?.hasSmartLock ?? false,
    lockEntityId: hardware?.lockEntityId ?? "",
  });

  // Fetch entities when expanding
  useEffect(() => {
    if (expanded && entities.length === 0 && !entitiesLoading) {
      setEntitiesLoading(true);
      browseHAEntities()
        .then(setEntities)
        .catch(() => {})
        .finally(() => setEntitiesLoading(false));
    }
  }, [expanded, entities.length, entitiesLoading]);

  function handleSave() {
    startTransition(async () => {
      await updateUnitHardware(cabin.id, {
        hasElectricity: values.hasElectricity,
        electricitySource: values.electricitySource,
        electricitySwitchEntityId: values.electricitySource === "HA" ? values.electricitySwitchEntityId || null : null,
        electricityMeterEntityId: values.electricitySource === "HA" ? values.electricityMeterEntityId || null : null,
        electricityPowerEntityId: values.electricitySource === "HA" ? values.electricityPowerEntityId || null : null,
        electricityMqttPrefix: values.electricitySource === "MQTT" ? values.electricityMqttPrefix.trim() || null : null,
        electricityMqttComponent: values.electricitySource === "MQTT" ? values.electricityMqttComponent.trim() || null : null,
        hasHeating: values.hasHeating,
        heatingSource: values.heatingSource,
        heatingSwitchEntityId: values.heatingSource === "HA" ? values.heatingSwitchEntityId || null : null,
        heatingMeterEntityId: values.heatingSource === "HA" ? values.heatingMeterEntityId || null : null,
        heatingPowerEntityId: values.heatingSource === "HA" ? values.heatingPowerEntityId || null : null,
        heatingMqttPrefix: values.heatingSource === "MQTT" ? values.heatingMqttPrefix.trim() || null : null,
        heatingMqttComponent: values.heatingSource === "MQTT" ? values.heatingMqttComponent.trim() || null : null,
        winterModeEnabled: values.winterModeEnabled,
        hasWater: values.hasWater,
        waterSource: values.waterSource,
        waterMeterEntityId: values.waterSource === "HA" ? values.waterMeterEntityId || null : null,
        waterMqttPrefix: values.waterSource === "MQTT" ? values.waterMqttPrefix.trim() || null : null,
        waterMqttComponent: values.waterSource === "MQTT" ? values.waterMqttComponent.trim() || null : null,
        hasClimate: values.hasClimate,
        climateEntityId: values.climateEntityId || null,
        hasSmartLock: values.hasSmartLock,
        lockEntityId: values.lockEntityId || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    });
  }

  const capabilities = [
    hardware?.hasElectricity && "El",
    hardware?.hasHeating && "Varme",
    hardware?.hasWater && "Vand",
    hardware?.hasClimate && "Klima",
    hardware?.hasSmartLock && "Lås",
  ].filter(Boolean);

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm">
      <button
        className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{typeLabels[cabin.type] || cabin.type} {cabin.name}</span>
          {capabilities.length > 0 && (
            <span className="text-xs text-muted-foreground">
              ({capabilities.join(", ")})
            </span>
          )}
          {hardware?.winterModeEnabled && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
              Vinterdrift
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-5 py-5 space-y-5">
          {/* Electricity */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Elektricitet (hovedrelæ)</Label>
              <Switch
                checked={values.hasElectricity}
                onCheckedChange={(checked) =>
                  setValues((v) => ({ ...v, hasElectricity: checked }))
                }
              />
            </div>
            {values.hasElectricity && (
              <div className="space-y-3 pl-3 border-l-2 border-border">
                <SourceSelect
                  value={values.electricitySource}
                  onChange={(v) => setValues((s) => ({ ...s, electricitySource: v }))}
                />
                {values.electricitySource === "HA" ? (
                  <>
                    <div>
                      <Label className="text-xs text-muted-foreground">Relæ (tænd/sluk strøm)</Label>
                      <EntityPicker
                        value={values.electricitySwitchEntityId}
                        onChange={(v) => setValues((s) => ({ ...s, electricitySwitchEntityId: v }))}
                        entities={entities}
                        loading={entitiesLoading}
                        filterCategory={["switch"]}
                        placeholder="Vælg switch entity..."
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Elmåler (kWh)</Label>
                      <EntityPicker
                        value={values.electricityMeterEntityId}
                        onChange={(v) => setValues((s) => ({ ...s, electricityMeterEntityId: v }))}
                        entities={entities}
                        loading={entitiesLoading}
                        filterCategory={["sensor_energy"]}
                        placeholder="Vælg energi-sensor..."
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Live effekt (W) — valgfri</Label>
                      <EntityPicker
                        value={values.electricityPowerEntityId}
                        onChange={(v) => setValues((s) => ({ ...s, electricityPowerEntityId: v }))}
                        entities={entities}
                        loading={entitiesLoading}
                        filterCategory={["sensor_power"]}
                        placeholder="Vælg effekt-sensor (W)..."
                      />
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">MQTT Prefix</Label>
                      <Input
                        value={values.electricityMqttPrefix}
                        onChange={(e) => setValues((s) => ({ ...s, electricityMqttPrefix: e.target.value }))}
                        placeholder="shellyplus1pm-abc123"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Komponent</Label>
                      <Input
                        value={values.electricityMqttComponent}
                        onChange={(e) => setValues((s) => ({ ...s, electricityMqttComponent: e.target.value }))}
                        placeholder="switch:0"
                        className="mt-1"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Heating (separate relay) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Varme (separat relæ)</Label>
              <Switch
                checked={values.hasHeating}
                onCheckedChange={(checked) =>
                  setValues((v) => ({ ...v, hasHeating: checked }))
                }
              />
            </div>
            {values.hasHeating && (
              <div className="space-y-3 pl-3 border-l-2 border-border">
                <SourceSelect
                  value={values.heatingSource}
                  onChange={(v) => setValues((s) => ({ ...s, heatingSource: v }))}
                />
                {values.heatingSource === "HA" ? (
                  <>
                    <div>
                      <Label className="text-xs text-muted-foreground">Varmerelæ (tænd/sluk el-radiatorer)</Label>
                      <EntityPicker
                        value={values.heatingSwitchEntityId}
                        onChange={(v) => setValues((s) => ({ ...s, heatingSwitchEntityId: v }))}
                        entities={entities}
                        loading={entitiesLoading}
                        filterCategory={["switch"]}
                        placeholder="Vælg switch entity..."
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Varmemåler (valgfri, separat kWh)</Label>
                      <EntityPicker
                        value={values.heatingMeterEntityId}
                        onChange={(v) => setValues((s) => ({ ...s, heatingMeterEntityId: v }))}
                        entities={entities}
                        loading={entitiesLoading}
                        filterCategory={["sensor_energy"]}
                        placeholder="Vælg energi-sensor (valgfri)..."
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Live varmeeffekt (W) — valgfri</Label>
                      <EntityPicker
                        value={values.heatingPowerEntityId}
                        onChange={(v) => setValues((s) => ({ ...s, heatingPowerEntityId: v }))}
                        entities={entities}
                        loading={entitiesLoading}
                        filterCategory={["sensor_power"]}
                        placeholder="Vælg effekt-sensor (W)..."
                      />
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">MQTT Prefix</Label>
                      <Input
                        value={values.heatingMqttPrefix}
                        onChange={(e) => setValues((s) => ({ ...s, heatingMqttPrefix: e.target.value }))}
                        placeholder="shellyplus1pm-xyz"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Komponent</Label>
                      <Input
                        value={values.heatingMqttComponent}
                        onChange={(e) => setValues((s) => ({ ...s, heatingMqttComponent: e.target.value }))}
                        placeholder="switch:0"
                        className="mt-1"
                      />
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <div>
                    <Label className="text-sm">Vinterdrift</Label>
                    <p className="text-xs text-muted-foreground">Hold varmen tændt når enheden er ledig</p>
                  </div>
                  <Switch
                    checked={values.winterModeEnabled}
                    onCheckedChange={(checked) =>
                      setValues((v) => ({ ...v, winterModeEnabled: checked }))
                    }
                  />
                </div>
                {values.winterModeEnabled && (
                  <div className="flex items-start gap-2 text-xs text-blue-600 bg-blue-50 px-3 py-2 rounded-md">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                    <span>Varmen slukkes ikke ved checkout — hytterne beskyttes mod frost</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Water */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Vand</Label>
              <Switch
                checked={values.hasWater}
                onCheckedChange={(checked) =>
                  setValues((v) => ({ ...v, hasWater: checked }))
                }
              />
            </div>
            {values.hasWater && (
              <div className="space-y-3 pl-3 border-l-2 border-border">
                <SourceSelect
                  value={values.waterSource}
                  onChange={(v) => setValues((s) => ({ ...s, waterSource: v }))}
                />
                {values.waterSource === "HA" ? (
                  <div>
                    <Label className="text-xs text-muted-foreground">Vandmåler (liter)</Label>
                    <EntityPicker
                      value={values.waterMeterEntityId}
                      onChange={(v) => setValues((s) => ({ ...s, waterMeterEntityId: v }))}
                      entities={entities}
                      loading={entitiesLoading}
                      filterCategory={["sensor_water"]}
                      placeholder="Vælg vand-sensor..."
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">MQTT Prefix</Label>
                      <Input
                        value={values.waterMqttPrefix}
                        onChange={(e) => setValues((s) => ({ ...s, waterMqttPrefix: e.target.value }))}
                        placeholder="shellyuni-water"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Komponent</Label>
                      <Input
                        value={values.waterMqttComponent}
                        onChange={(e) => setValues((s) => ({ ...s, waterMqttComponent: e.target.value }))}
                        placeholder="input:0"
                        className="mt-1"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Climate */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Klima (wifi-termostat)</Label>
              <Switch
                checked={values.hasClimate}
                onCheckedChange={(checked) =>
                  setValues((v) => ({ ...v, hasClimate: checked }))
                }
              />
            </div>
            {values.hasClimate && (
              <div className="pl-3 border-l-2 border-border">
                <Label className="text-xs text-muted-foreground">Climate Entity ID</Label>
                <EntityPicker
                  value={values.climateEntityId}
                  onChange={(v) => setValues((s) => ({ ...s, climateEntityId: v }))}
                  entities={entities}
                  loading={entitiesLoading}
                  filterCategory={["climate"]}
                  placeholder="Vælg climate entity..."
                />
              </div>
            )}
          </div>

          {/* Smart Lock */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Smart lås</Label>
              <Switch
                checked={values.hasSmartLock}
                onCheckedChange={(checked) =>
                  setValues((v) => ({ ...v, hasSmartLock: checked }))
                }
              />
            </div>
            {values.hasSmartLock && (
              <div className="pl-3 border-l-2 border-border">
                <Label className="text-xs text-muted-foreground">Lock Entity ID</Label>
                <EntityPicker
                  value={values.lockEntityId}
                  onChange={(v) => setValues((s) => ({ ...s, lockEntityId: v }))}
                  entities={entities}
                  loading={entitiesLoading}
                  filterCategory={["lock"]}
                  placeholder="Vælg lock entity..."
                />
              </div>
            )}
          </div>

          <Button onClick={handleSave} disabled={isPending} size="sm">
            <Save className="h-3 w-3 mr-1.5" />
            {isPending ? "Gemmer..." : saved ? "Gemt!" : "Gem hardware"}
          </Button>
        </div>
      )}
    </div>
  );
}
