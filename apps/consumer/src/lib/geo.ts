/**
 * Geo helpers for near-me-style features.
 *
 * Distance math runs client-side because every search result already
 * carries the place's lat/lng — there's no need to round-trip a
 * `distance_meters` column on the wire just to render a label. The
 * haversine formula is fine at restaurant scale: it ignores Earth's
 * polar flattening (off by < 0.5% at the equator, less at higher
 * latitudes), well below "5 mi away" rounding.
 */

const EARTH_RADIUS_METERS = 6_371_000;

/** Great-circle distance between two lat/lng points, in meters. */
export function haversineDistanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const sinHalfDLat = Math.sin(dLat / 2);
  const sinHalfDLng = Math.sin(dLng / 2);
  const h =
    sinHalfDLat * sinHalfDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinHalfDLng * sinHalfDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_METERS * c;
}

const METERS_PER_MILE = 1609.344;

/**
 * Format a distance in meters as a short human-readable string in
 * miles. Tuned for the kinds of numbers that actually show up next
 * to a restaurant card:
 *
 *   * Under 0.1 mi  → "<0.1 mi away"  (avoids "0.0 mi" looking wrong)
 *   * 0.1 – 9.9 mi  → "2.3 mi away"   (one decimal so adjacent rows
 *                                     read distinctly)
 *   * 10+ mi        → "12 mi away"    (whole number once spread is
 *                                     wide enough that decimals don't
 *                                     help the user)
 */
export function formatDistanceMiles(meters: number): string {
  const miles = meters / METERS_PER_MILE;
  if (miles < 0.1) return "<0.1 mi away";
  if (miles < 10) return `${miles.toFixed(1)} mi away`;
  return `${Math.round(miles)} mi away`;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
