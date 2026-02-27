import { atom, onMount } from "nanostores";
import { api } from "../services/api";

export const isAuthenticated = atom(false);
export const userRegion = atom("vn");
export const userEmail = atom("");

const SESSION_KEY = "vf_session";

function readBrowserSession() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    // Expire stale metadata quickly for non-remember sessions.
    if (parsed.expiresAt && parsed.expiresAt <= Date.now()) {
      window.localStorage.removeItem(SESSION_KEY);
      return null;
    }

    return parsed;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function syncAuthState() {
  try {
    // Keep API session state in sync before deriving UI auth state.
    api.restoreSession();
  } catch {
    // Non-fatal: keep fallback checks based on metadata only.
  }

  const session = readBrowserSession();

  const authenticated = Boolean(
    api.isLoggedIn || session || api.getCookie?.(SESSION_KEY),
  );

  isAuthenticated.set(authenticated);
  if (authenticated) {
    if (session?.region) {
      userRegion.set(session.region);
    } else {
      userRegion.set(api.region || "vn");
    }

    userEmail.set(session?.email || "");
  } else {
    userRegion.set("vn");
    userEmail.set("");
  }

  return authenticated;
}

onMount(isAuthenticated, () => {
  syncAuthState();

  if (typeof window === "undefined") return;

  const handler = (event) => {
    if (event.key === SESSION_KEY) {
      syncAuthState();
    }
  };

  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
});

export function refreshAuthState() {
  return syncAuthState();
}
