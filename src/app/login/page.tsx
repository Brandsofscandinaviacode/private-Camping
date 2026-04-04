import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { LoginForm } from "@/components/auth/login-form";
import { Tent } from "lucide-react";

export default async function LoginPage() {
  if (await isAuthenticated()) {
    redirect("/admin");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <Tent className="h-10 w-10 mx-auto text-primary" />
          <h1 className="text-2xl font-bold mt-3">CampFlow</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Log ind for at administrere campingpladsen
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
