import { Feather } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { apiFetch } from "@/lib/api/client";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Card, Cell, Chip, IcBox, Seg } from "@/ui/kit";

export type PickedLocation = { lat: number; lng: number; label: string };

// ---------------------------------------------------------------------------
// Recent picks — tiny JSON list in SecureStore (last 3, deduped by
// label). Local-only convenience; never leaves the device.
// ---------------------------------------------------------------------------
type RecentLocation = PickedLocation & { at: number };
const RECENTS_KEY = "recent_locations_v1";

async function loadRecents(): Promise<RecentLocation[]> {
  try {
    const raw = await SecureStore.getItemAsync(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as RecentLocation[]) : [];
  } catch {
    return [];
  }
}

async function pushRecent(loc: PickedLocation) {
  const prev = await loadRecents();
  const next = [{ ...loc, at: Date.now() }, ...prev.filter((r) => r.label !== loc.label)].slice(0, 3);
  await SecureStore.setItemAsync(RECENTS_KEY, JSON.stringify(next)).catch(() => undefined);
}

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Same curated shortlist the web picker leads with (lib/cities). */
const POPULAR: PickedLocation[] = [
  { label: "New York, NY", lat: 40.7128, lng: -74.006 },
  { label: "Chicago, IL", lat: 41.8781, lng: -87.6298 },
  { label: "Atlanta, GA", lat: 33.749, lng: -84.388 },
  { label: "Houston, TX", lat: 29.7604, lng: -95.3698 },
  { label: "Dearborn, MI", lat: 42.3223, lng: -83.1763 },
  { label: "Los Angeles, CA", lat: 34.0522, lng: -118.2437 },
  { label: "Dallas, TX", lat: 32.7767, lng: -96.797 },
  { label: "Toronto, Canada", lat: 43.6532, lng: -79.3832 },
];

type GeocodeMatch = { label: string; lat: number; lng: number; city: string | null; region: string | null };

function useForwardGeocode(q: string) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: ["places", "forward-geocode", trimmed.toLowerCase()],
    queryFn: () =>
      apiFetch<{ results: GeocodeMatch[] } | GeocodeMatch[]>(
        `/places/google/forward-geocode?q=${encodeURIComponent(trimmed)}`,
      ),
    enabled: trimmed.length >= 3,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/** Mockup 14 wired: current location · popular cities · free search
 *  through the forward-geocode proxy. */
export function LocationSheet({
  visible,
  onClose,
  onUseMyLocation,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onUseMyLocation: () => void;
  onPick: (loc: PickedLocation) => void;
}) {
  const t = useTheme();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const geo = useForwardGeocode(q);
  const recents = useQuery({ queryKey: ["recent-locations"], queryFn: loadRecents, enabled: visible });
  const matches: GeocodeMatch[] = Array.isArray(geo.data) ? geo.data : (geo.data?.results ?? []);

  const pick = (loc: PickedLocation) => {
    setQ("");
    void pushRecent(loc).then(() => qc.invalidateQueries({ queryKey: ["recent-locations"] }));
    onPick(loc);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(9,9,11,0.5)" }} onPress={onClose} />
      <View style={{ backgroundColor: t.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: space.lg, paddingBottom: 34, maxHeight: "85%" }}>
        <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 4, backgroundColor: t.line, marginVertical: 12 }} />
        <Text style={[ty.h2, { color: t.ink, marginBottom: space.md }]}>Where to?</Text>
        <ScrollView keyboardShouldPersistTaps="handled">
          <Card style={{ borderWidth: 1.5, borderColor: t.accentSoft }}>
            <Cell
              last
              onPress={() => { onUseMyLocation(); onClose(); }}
              left={
                <>
                  <IcBox icon="navigation" bg={t.accentSoft} fg={t.accentDeep} />
                  <View>
                    <Text style={[ty.label, { color: t.ink, fontSize: 13 }]}>Use my current location</Text>
                    <Text style={[ty.small, { color: t.sub }]}>Asks the system for permission</Text>
                  </View>
                </>
              }
              right={<Feather name="chevron-right" size={16} color={t.sub} />}
            />
          </Card>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: t.card, borderRadius: radii.lg, paddingHorizontal: 14, minHeight: 48, marginTop: space.md }}>
            <Feather name="search" size={16} color={t.sub} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Any city, neighborhood, or address"
              placeholderTextColor={t.sub}
              style={[ty.body, { color: t.ink, flex: 1, paddingVertical: 12 }]}
              autoCapitalize="words"
            />
          </View>

          {q.trim().length >= 3 ? (
            <Card style={{ marginTop: space.sm }}>
              {geo.isLoading ? (
                <Cell last left={<Text style={[ty.small, { color: t.sub }]}>Searching…</Text>} />
              ) : matches.length === 0 ? (
                <Cell last left={<Text style={[ty.small, { color: t.sub }]}>No matches — try a city name.</Text>} />
              ) : (
                matches.slice(0, 5).map((m, i, arr) => (
                  <Cell
                    key={m.label}
                    last={i === arr.length - 1}
                    onPress={() => pick({ lat: m.lat, lng: m.lng, label: m.city ? `${m.city}${m.region ? `, ${m.region}` : ""}` : m.label })}
                    left={<Text style={[ty.body, { color: t.ink }]}>{m.label}</Text>}
                  />
                ))
              )}
            </Card>
          ) : (
            <>
              <Seg style={{ marginTop: space.lg, marginBottom: 8 }}>Popular</Seg>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {POPULAR.map((c) => (
                  <Chip key={c.label} label={c.label} onPress={() => pick(c)} />
                ))}
              </View>

              {(recents.data ?? []).length > 0 ? (
                <>
                  <Seg style={{ marginTop: space.lg, marginBottom: 8 }}>Recent</Seg>
                  <Card>
                    {(recents.data ?? []).map((r, i, arr) => (
                      <Cell
                        key={r.label}
                        last={i === arr.length - 1}
                        onPress={() => pick(r)}
                        left={
                          <>
                            <Feather name="clock" size={15} color={t.sub} />
                            <Text style={[ty.body, { color: t.ink }]}>{r.label}</Text>
                          </>
                        }
                        right={<Text style={[ty.small, { color: t.sub }]}>{ago(r.at)}</Text>}
                      />
                    ))}
                  </Card>
                </>
              ) : null}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
