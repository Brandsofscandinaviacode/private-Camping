import { AsyncLocalStorage } from "async_hooks";

const apiAuthContext = new AsyncLocalStorage<{ authenticated: boolean }>();

export function runWithApiAuth<T>(fn: () => Promise<T>): Promise<T> {
  return apiAuthContext.run({ authenticated: true }, fn);
}

export function isApiAuthenticated(): boolean {
  return apiAuthContext.getStore()?.authenticated === true;
}
