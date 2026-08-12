import { create } from "zustand";

import { apiFetch, ApiError } from "@/lib/api/client";
import type { MeRead, MobileAuthResponse } from "@/lib/api/types";
import { tokenStore } from "@/lib/auth/token-store";
import { registerForPush, unregisterPush } from "@/lib/push";

type Status = "loading" | "authed" | "unauthed";

type AuthState = {
  status: Status;
  user: MeRead | null;
  /** Resolve the current token to a user on cold start. */
  bootstrap: () => Promise<void>;
  /** Email/password sign-in. Throws on failure; the caller shows the message. */
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

/** Staff-only guard: the console must refuse any non-ADMIN account even if
 *  the credentials are otherwise valid. */
class NotStaffError extends Error {
  constructor() {
    super("This app is for Trust Halal staff only.");
    this.name = "NotStaffError";
  }
}

export const useAuth = create<AuthState>((set) => ({
  status: "loading",
  user: null,

  async bootstrap() {
    const { access } = await tokenStore.get();
    if (!access) {
      set({ status: "unauthed", user: null });
      return;
    }
    try {
      const me = await apiFetch<MeRead>("/me");
      if (me.role !== "ADMIN") {
        await tokenStore.clear();
        set({ status: "unauthed", user: null });
        return;
      }
      set({ status: "authed", user: me });
      // Fire-and-forget: a push-registration failure must never block entry.
      void registerForPush();
    } catch (err) {
      // A hard 401 after a failed refresh means the token is dead.
      if (err instanceof ApiError && err.status === 401) {
        await tokenStore.clear();
        set({ status: "unauthed", user: null });
        return;
      }
      // Network/5xx: keep the token, but we can't confirm the session now.
      set({ status: "unauthed", user: null });
    }
  },

  async login(email, password) {
    const res = await apiFetch<MobileAuthResponse>("/auth/mobile/login", {
      method: "POST",
      body: JSON.stringify({ email: email.trim(), password }),
    });
    if (res.user.role !== "ADMIN") {
      // Don't persist a non-staff session.
      throw new NotStaffError();
    }
    await tokenStore.set({
      access: res.access_token,
      refresh: res.refresh_token,
    });
    set({
      status: "authed",
      user: {
        id: res.user.id,
        email: res.user.email,
        role: res.user.role,
        display_name: res.user.display_name,
      },
    });
    void registerForPush();
  },

  async logout() {
    await unregisterPush().catch(() => undefined);
    await apiFetch("/auth/mobile/logout", { method: "POST" }).catch(
      () => undefined,
    );
    await tokenStore.clear();
    set({ status: "unauthed", user: null });
  },
}));
