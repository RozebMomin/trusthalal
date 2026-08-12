import * as SecureStore from "expo-secure-store";

/** iOS Keychain / Android Keystore via SecureStore. Both tokens live under
 *  one key as a JSON blob so the access+refresh pair is written and cleared
 *  atomically. AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY keeps the refresh token
 *  from migrating to another device via an encrypted backup restore. */
const KEY = "staff_auth_tokens_v1";
const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

type Tokens = { access: string; refresh: string };

export const tokenStore = {
  async get(): Promise<{ access: string | null; refresh: string | null }> {
    const blob = await SecureStore.getItemAsync(KEY);
    if (!blob) return { access: null, refresh: null };
    try {
      const parsed = JSON.parse(blob) as Tokens;
      return { access: parsed.access ?? null, refresh: parsed.refresh ?? null };
    } catch {
      return { access: null, refresh: null };
    }
  },
  async set(tokens: Tokens) {
    await SecureStore.setItemAsync(KEY, JSON.stringify(tokens), OPTS);
  },
  async clear() {
    await SecureStore.deleteItemAsync(KEY);
  },
};
