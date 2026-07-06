import * as SecureStore from "expo-secure-store";

/** iOS Keychain / Android Keystore via SecureStore — the right home
 *  for anything you'd feel bad losing. */
export const tokenStore = {
  async get() {
    const [access, refresh] = await Promise.all([
      SecureStore.getItemAsync("access_token"),
      SecureStore.getItemAsync("refresh_token"),
    ]);
    return { access, refresh };
  },
  async set(tokens: { access: string; refresh: string }) {
    await Promise.all([
      SecureStore.setItemAsync("access_token", tokens.access),
      SecureStore.setItemAsync("refresh_token", tokens.refresh),
    ]);
  },
  async clear() {
    await Promise.all([
      SecureStore.deleteItemAsync("access_token"),
      SecureStore.deleteItemAsync("refresh_token"),
    ]);
  },
};
