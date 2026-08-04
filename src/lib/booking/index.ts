import type { BookingProvider } from "./types";
import { createDanplannerProvider } from "./danplanner";

export type { BookingProvider, BookingResource, BookingResourceType, BookingLoginResult, BookingVerifyResult } from "./types";
export { danplannerLogin, danplannerVerify2FA } from "./danplanner";

export type BookingProviderType = "danplanner" | "none";

export function getBookingProvider(
  provider: BookingProviderType,
  settings: Record<string, string>,
  /** Persist a session refreshed by an automatic re-login. */
  onSessionRefreshed?: (cookies: string) => void | Promise<void>,
): BookingProvider | null {
  switch (provider) {
    case "danplanner":
      return createDanplannerProvider({
        baseUrl: settings.danplanner_url || "https://admin.danplanner.dk",
        username: settings.danplanner_username || "",
        password: settings.danplanner_password || "",
        sessionCookies: settings.danplanner_cookies || "",
        onSessionRefreshed,
      });
    case "none":
    default:
      return null;
  }
}
