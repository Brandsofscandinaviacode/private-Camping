import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { LoginForm } from "@/components/auth/login-form";
import { Tent } from "lucide-react";

export default async function LoginPage() {
  if (await isAuthenticated()) {
    redirect("/admin");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="h-14 w-14 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto">
            <Tent className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold mt-4 tracking-tight">CampFlow</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Log ind for at administrere campingpladsen
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
