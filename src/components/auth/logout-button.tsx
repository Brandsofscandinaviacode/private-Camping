"use client";

import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logout } from "@/lib/auth";

export function LogoutButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => logout()}
      className="text-muted-foreground"
    >
      <LogOut className="h-3 w-3 mr-1" />
      Log ud
    </Button>
  );
}
