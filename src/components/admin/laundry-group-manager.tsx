"use client";

import { useState, useRef, useEffect } from "react";
import {
  QrCode,
  Plus,
  Trash2,
  Edit2,
  Download,
  WashingMachine,
  Check,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createLaundryGroup,
  updateLaundryGroup,
  deleteLaundryGroup,
} from "@/lib/actions";
import QRCode from "qrcode";

interface LaundryGroup {
  id: number;
  name: string;
  token: string;
  machines: { id: number; name: string }[];
}

interface MachineOption {
  id: number;
  name: string;
  groupId: number | null;
}

interface Props {
  initialGroups: LaundryGroup[];
  allMachines: MachineOption[];
  baseUrl: string;
}

export function LaundryGroupManager({ initialGroups, allMachines, baseUrl }: Props) {
  const [groups, setGroups] = useState(initialGroups);
  const [machines, setMachines] = useState(allMachines);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [selectedMachineIds, setSelectedMachineIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [qrCanvasGroup, setQrCanvasGroup] = useState<number | null>(null);

  function getUrl(token: string) {
    const base = baseUrl || (typeof window !== "undefined" ? window.location.origin : "");
    return `${base}/laundry/${token}`;
  }

  function toggleMachine(id: number) {
    setSelectedMachineIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function startCreate() {
    setShowCreate(true);
    setEditingId(null);
    setName("");
    setSelectedMachineIds([]);
  }

  function startEdit(group: LaundryGroup) {
    setEditingId(group.id);
    setShowCreate(false);
    setName(group.name);
    setSelectedMachineIds(group.machines.map((m) => m.id));
  }

  function cancelForm() {
    setShowCreate(false);
    setEditingId(null);
    setName("");
    setSelectedMachineIds([]);
  }

  async function handleSave() {
    if (!name.trim()) return;
    setLoading(true);
    try {
      if (editingId) {
        await updateLaundryGroup(editingId, name.trim(), selectedMachineIds);
      } else {
        await createLaundryGroup(name.trim(), selectedMachineIds);
      }
      // Refresh — refetch from window location
      window.location.reload();
    } catch (e) {
      console.error("Save error:", e);
      setLoading(false);
    }
  }

  async function handleDelete(groupId: number) {
    if (!confirm("Er du sikker på du vil slette denne gruppe?")) return;
    setLoading(true);
    try {
      await deleteLaundryGroup(groupId);
      window.location.reload();
    } catch (e) {
      console.error("Delete error:", e);
      setLoading(false);
    }
  }

  async function copyUrl(token: string) {
    await navigator.clipboard.writeText(getUrl(token));
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  }

  async function downloadQR(group: LaundryGroup) {
    const url = getUrl(group.token);
    try {
      const dataUrl = await QRCode.toDataURL(url, {
        width: 512,
        margin: 2,
        color: { dark: "#000000", light: "#FFFFFF" },
      });
      const a = document.createElement("a");
      a.download = `qr-${group.name.toLowerCase().replace(/\s+/g, "-")}.png`;
      a.href = dataUrl;
      a.click();
    } catch (e) {
      console.error("QR generation error:", e);
    }
  }

  async function showQRPreview(group: LaundryGroup) {
    setQrCanvasGroup(qrCanvasGroup === group.id ? null : group.id);
  }

  // Which machines are already assigned to other groups
  function isMachineAvailable(machineId: number) {
    const m = machines.find((x) => x.id === machineId);
    if (!m) return false;
    if (m.groupId === null) return true;
    if (editingId && m.groupId === editingId) return true;
    return false;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <QrCode className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">QR-koder til vaskerum</h2>
        </div>
        {!showCreate && editingId === null && (
          <Button size="sm" onClick={startCreate}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Ny gruppe
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground -mt-2">
        Opret grupper af maskiner og generer QR-koder som kunder kan skanne for at starte og betale.
      </p>

      {/* Create / Edit form */}
      {(showCreate || editingId !== null) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {editingId ? "Rediger gruppe" : "Ny QR-gruppe"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Gruppenavn</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="f.eks. Vaskerum 1, Bygning A"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Maskiner i gruppen</label>
              <div className="space-y-1.5">
                {allMachines.map((m) => {
                  const available = isMachineAvailable(m.id);
                  const selected = selectedMachineIds.includes(m.id);
                  const assignedGroup = groups.find((g) => g.id === m.groupId && g.id !== editingId);
                  return (
                    <label
                      key={m.id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all cursor-pointer ${
                        selected
                          ? "border-primary/40 bg-primary/5"
                          : available
                          ? "border-border/60 hover:border-primary/20"
                          : "border-border/30 opacity-50 cursor-not-allowed"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => available && toggleMachine(m.id)}
                        disabled={!available}
                        className="accent-primary"
                      />
                      <WashingMachine className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{m.name}</span>
                      {assignedGroup && (
                        <span className="text-xs text-muted-foreground ml-auto">
                          (i &quot;{assignedGroup.name}&quot;)
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
              {allMachines.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Ingen maskiner konfigureret. Tilføj maskiner under Indstillinger → Vaskerum.
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={loading || !name.trim()}>
                {loading ? "Gemmer..." : editingId ? "Gem ændringer" : "Opret gruppe"}
              </Button>
              <Button variant="outline" onClick={cancelForm} disabled={loading}>
                Annuller
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Existing groups */}
      {groups.length === 0 && !showCreate && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <QrCode className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Ingen QR-grupper oprettet endnu</p>
            <p className="text-xs mt-1">Opret en gruppe for at generere en QR-kode til dine maskiner</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {groups.map((group) => (
          <Card key={group.id} className="overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <div>
                <h3 className="font-semibold">{group.name}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {group.machines.length} {group.machines.length === 1 ? "maskine" : "maskiner"}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => startEdit(group)}
                  title="Rediger"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => handleDelete(group.id)}
                  title="Slet"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="p-5 space-y-3">
              {/* Machines list */}
              <div className="flex flex-wrap gap-1.5">
                {group.machines.map((m) => (
                  <span
                    key={m.id}
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-muted text-muted-foreground"
                  >
                    <WashingMachine className="h-3 w-3" />
                    {m.name}
                  </span>
                ))}
                {group.machines.length === 0 && (
                  <p className="text-xs text-muted-foreground">Ingen maskiner tilknyttet</p>
                )}
              </div>

              {/* URL */}
              <div className="flex items-center gap-2">
                <div className="flex-1 text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2 truncate font-mono">
                  /laundry/{group.token}
                </div>
                <Button
                  variant="outline"
                  size="icon-xs"
                  onClick={() => copyUrl(group.token)}
                  title="Kopiér link"
                >
                  {copiedToken === group.token ? (
                    <Check className="h-3 w-3 text-green-600" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>

              {/* QR Preview */}
              {qrCanvasGroup === group.id && (
                <QRPreview url={getUrl(group.token)} />
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => showQRPreview(group)}
                >
                  <QrCode className="h-3.5 w-3.5 mr-1.5" />
                  {qrCanvasGroup === group.id ? "Skjul QR" : "Vis QR"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => downloadQR(group)}
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Download PNG
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// QR Preview component — renders QR inline
function QRPreview({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [, setRendered] = useState(false);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, url, {
        width: 200,
        margin: 2,
        color: { dark: "#000000", light: "#FFFFFF" },
      }).then(() => setRendered(true));
    }
  }, [url]);

  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <canvas ref={canvasRef} className="rounded-lg border border-border/60" />
      <p className="text-[10px] text-muted-foreground text-center break-all max-w-[200px]">{url}</p>
    </div>
  );
}
