"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateLongTermTenant, removeLongTermTenant } from "@/lib/actions";

interface LongTermTenantFormProps {
  unitId: number;
  unitName: string;
  tenant: {
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
}

export function LongTermTenantForm({ unitId, unitName, tenant }: LongTermTenantFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(tenant?.name || "");
  const [email, setEmail] = useState(tenant?.email || "");
  const [phone, setPhone] = useState(tenant?.phone || "");
  const [confirmRemove, setConfirmRemove] = useState(false);

  const hasTenant = !!tenant?.name;

  function handleSave() {
    if (!name.trim()) return;
    startTransition(async () => {
      await updateLongTermTenant(unitId, {
        longTermGuestName: name.trim(),
        longTermGuestEmail: email.trim(),
        longTermGuestPhone: phone.trim(),
      });
      router.refresh();
    });
  }

  function handleRemove() {
    startTransition(async () => {
      await removeLongTermTenant(unitId);
      setName("");
      setEmail("");
      setPhone("");
      setConfirmRemove(false);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="font-semibold">{hasTenant ? "Langtidslejer" : "Registrér lejer"}</h2>
      </div>
      <div className="p-5 space-y-4">
        <div>
          <Label className="text-sm text-muted-foreground">Navn *</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Lejerens fulde navn"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-sm text-muted-foreground">Email</Label>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="lejer@email.dk"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-sm text-muted-foreground">Telefon</Label>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+45 12345678"
            className="mt-1"
          />
        </div>
        <div className="flex items-center gap-3 pt-1">
          <Button size="sm" disabled={isPending || !name.trim()} onClick={handleSave}>
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <UserPlus className="h-3.5 w-3.5 mr-1.5" />
            )}
            {hasTenant ? "Opdatér lejer" : "Registrér lejer"}
          </Button>
          {hasTenant && !confirmRemove && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmRemove(true)}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Fjern lejer
            </Button>
          )}
          {confirmRemove && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-red-600">Er du sikker?</span>
              <Button variant="destructive" size="sm" disabled={isPending} onClick={handleRemove}>
                Ja, fjern
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmRemove(false)}>
                Annullér
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
