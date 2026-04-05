import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { LoginForm } from "@/components/auth/login-form";
import { Tent } from "lucide-react";

export default async function LoginPage() {
  if (await isAuthenticated()) {
    redirect("/admin");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-muted/30">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="h-16 w-16 rounded-2xl bg-primary flex items-center justify-center mx-auto">
            <Tent className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold mt-5 tracking-tight">CampFlow</h1>
          <p className="text-muted-foreground mt-1">
            Log ind for at administrere campingpladsen
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
