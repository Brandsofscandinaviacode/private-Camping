"use client";

import { useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePassword } from "@/lib/auth";

interface ChangePasswordFormProps {
  userId: number;
}

export function ChangePasswordForm({ userId }: ChangePasswordFormProps) {
  const [isPending, startTransition] = useTransition();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function handleSubmit() {
    setError("");
    setMessage("");

    if (newPassword.length < 6) {
      setError("Adgangskoden skal være mindst 6 tegn");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Adgangskoderne matcher ikke");
      return;
    }

    startTransition(async () => {
      try {
        await changePassword(userId, newPassword);
        setMessage("Adgangskode ændret!");
        setNewPassword("");
        setConfirmPassword("");
        setTimeout(() => setMessage(""), 3000);
      } catch {
        setError("Kunne ikke ændre adgangskoden");
      }
    });
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Skift adgangskode</h2>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Ny adgangskode
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="new-password">Ny adgangskode</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mindst 6 tegn"
            />
          </div>
          <div>
            <Label htmlFor="confirm-password">Bekræft adgangskode</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Gentag adgangskode"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          {message && (
            <p className="text-sm text-green-600">{message}</p>
          )}

          <Button
            onClick={handleSubmit}
            disabled={isPending || !newPassword || !confirmPassword}
          >
            {isPending ? "Gemmer..." : "Skift adgangskode"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
