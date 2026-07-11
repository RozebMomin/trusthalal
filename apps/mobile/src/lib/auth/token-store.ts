import * as SecureStore from "expo-secure-store";

/** iOS Keychain / Android Keystore via SecureStore — the right home
 *  for anything you'd feel bad losing.
 *
 *  Both tokens live under ONE key as a JSON blob so the access+refresh
 *  pair is written and cleared atomically — a crash between two separate
 *  writes could otherwise strand a stale refresh token, and with
 *  single-use rotation that means a forced logout.
 *
 *  ``keychainAccessible: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`` keeps the
 *  30-day refresh token from migrating to another device via an
 *  encrypted backup restore, while still allowing reads after the first
 *  unlock following a reboot (so a backgrounded refresh isn't blocked).
 */
const KEY = "auth_tokens_v1";
const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

// Legacy per-token keys (pre-v1). Read once for migration, then deleted.
const LEGACY_ACCESS = "access_token";
const LEGACY_REFRESH = "refresh_token";

type Tokens = { access: string; refresh: string };

export const tokenStore = {
  async get(): Promise<{ access: string | null; refresh: string | null }> {
    const blob = await SecureStore.getItemAsync(KEY);
    if (blob) {
      try {
        const parsed = JSON.parse(blob) as Tokens;
        return { access: parsed.access ?? null, refresh: parsed.refresh ?? null };
      } catch {
        // Corrupt blob — treat as signed out.
        return { access: null, refresh: null };
      }
    }
    // Migrate a user who signed in before the single-key format.
    const [access, refresh] = await Promise.all([
      SecureStore.getItemAsync(LEGACY_ACCESS),
      SecureStore.getItemAsync(LEGACY_REFRESH),
    ]);
    if (access && refresh) {
      await this.set({ access, refresh });
      await Promise.all([
        SecureStore.deleteItemAsync(LEGACY_ACCESS),
        SecureStore.deleteItemAsync(LEGACY_REFRESH),
      ]);
    }
    return { access: access ?? null, refresh: refresh ?? null };
  },
  async set(tokens: Tokens) {
    await SecureStore.setItemAsync(KEY, JSON.stringify(tokens), OPTS);
  },
  async clear() {
    await Promise.all([
      SecureStore.deleteItemAsync(KEY),
      // Best-effort cleanup of any lingering legacy keys.
      SecureStore.deleteItemAsync(LEGACY_ACCESS),
      SecureStore.deleteItemAsync(LEGACY_REFRESH),
    ]);
  },
};
