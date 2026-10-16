"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Opens the print dialog once the page has rendered (links with ?print=1). */
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 200);
    return () => clearTimeout(t);
  }, []);
  return null;
}

export function PrintButton() {
  return (
    <Button size="sm" onClick={() => window.print()}>
      <Printer className="h-4 w-4 mr-2" />
      Udskriv
    </Button>
  );
}
