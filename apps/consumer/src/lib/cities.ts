/**
 * Curated static city list for the location-picker prefix search.
 *
 * Why this exists
 * ---------------
 * The picker dialog used to fire a Google Geocoding request on every
 * debounced keystroke. That's expensive (per-call Google billing) and
 * slow (round-trip every time even for "Chicago"). 95% of queries
 * land on a well-known US city; we don't need Google for those.
 *
 * This module ships a hand-curated bundle of ~150 cities — every US
 * state capital, the top US metros by population, the high-halal-
 * density cities the audience actually searches for (Dearborn, Plano,
 * Bay Area, etc.), plus a handful of international cities. Each row
 * has the same ``ForwardGeocodeMatch`` shape the API returns so the
 * dialog can render local + remote results uniformly.
 *
 * The static list serves two roles:
 *   1. Instant prefix-match results while the user types (no network
 *      round-trip; no API quota burn).
 *   2. A fallback when the Google call errors / rate-limits — the
 *      visitor still gets a useful list to pick from.
 *
 * Anything not in this list falls through to Google Geocoding via
 * the existing ``useForwardGeocode`` hook. Long-tail queries
 * (international, neighborhoods, addresses) still work, just with
 * the debounce + network cost.
 */

import type { ForwardGeocodeMatch } from "@/lib/api/hooks";

// ---------------------------------------------------------------------------
// City entries — sorted alphabetically by label for diff-friendliness.
// ---------------------------------------------------------------------------

const CITIES: ReadonlyArray<ForwardGeocodeMatch> = [
  // US — major metros + state capitals + halal-density cities. Lat/lng
  // are city-center approximations sourced from public Census /
  // Wikipedia data; precision is ~5 decimals (~1m), well below the
  // 1-mi smallest near-me radius.
  { label: "Albany, NY, USA", lat: 42.6526, lng: -73.7562, city: "Albany", region: "NY", country_code: "US" },
  { label: "Albuquerque, NM, USA", lat: 35.0844, lng: -106.6504, city: "Albuquerque", region: "NM", country_code: "US" },
  { label: "Allentown, PA, USA", lat: 40.6084, lng: -75.4902, city: "Allentown", region: "PA", country_code: "US" },
  { label: "Anaheim, CA, USA", lat: 33.8366, lng: -117.9143, city: "Anaheim", region: "CA", country_code: "US" },
  { label: "Anchorage, AK, USA", lat: 61.2181, lng: -149.9003, city: "Anchorage", region: "AK", country_code: "US" },
  { label: "Annapolis, MD, USA", lat: 38.9784, lng: -76.4922, city: "Annapolis", region: "MD", country_code: "US" },
  { label: "Arlington, TX, USA", lat: 32.7357, lng: -97.1081, city: "Arlington", region: "TX", country_code: "US" },
  { label: "Arlington, VA, USA", lat: 38.8816, lng: -77.0910, city: "Arlington", region: "VA", country_code: "US" },
  { label: "Atlanta, GA, USA", lat: 33.7490, lng: -84.3880, city: "Atlanta", region: "GA", country_code: "US" },
  { label: "Augusta, GA, USA", lat: 33.4735, lng: -82.0105, city: "Augusta", region: "GA", country_code: "US" },
  { label: "Austin, TX, USA", lat: 30.2672, lng: -97.7431, city: "Austin", region: "TX", country_code: "US" },
  { label: "Bakersfield, CA, USA", lat: 35.3733, lng: -119.0187, city: "Bakersfield", region: "CA", country_code: "US" },
  { label: "Baltimore, MD, USA", lat: 39.2904, lng: -76.6122, city: "Baltimore", region: "MD", country_code: "US" },
  { label: "Baton Rouge, LA, USA", lat: 30.4515, lng: -91.1871, city: "Baton Rouge", region: "LA", country_code: "US" },
  { label: "Birmingham, AL, USA", lat: 33.5186, lng: -86.8104, city: "Birmingham", region: "AL", country_code: "US" },
  { label: "Bismarck, ND, USA", lat: 46.8083, lng: -100.7837, city: "Bismarck", region: "ND", country_code: "US" },
  { label: "Boise, ID, USA", lat: 43.6150, lng: -116.2023, city: "Boise", region: "ID", country_code: "US" },
  { label: "Boston, MA, USA", lat: 42.3601, lng: -71.0589, city: "Boston", region: "MA", country_code: "US" },
  { label: "Buffalo, NY, USA", lat: 42.8864, lng: -78.8784, city: "Buffalo", region: "NY", country_code: "US" },
  { label: "Cary, NC, USA", lat: 35.7915, lng: -78.7811, city: "Cary", region: "NC", country_code: "US" },
  { label: "Charleston, SC, USA", lat: 32.7765, lng: -79.9311, city: "Charleston", region: "SC", country_code: "US" },
  { label: "Charleston, WV, USA", lat: 38.3498, lng: -81.6326, city: "Charleston", region: "WV", country_code: "US" },
  { label: "Charlotte, NC, USA", lat: 35.2271, lng: -80.8431, city: "Charlotte", region: "NC", country_code: "US" },
  { label: "Chattanooga, TN, USA", lat: 35.0456, lng: -85.3097, city: "Chattanooga", region: "TN", country_code: "US" },
  { label: "Chesapeake, VA, USA", lat: 36.7682, lng: -76.2875, city: "Chesapeake", region: "VA", country_code: "US" },
  { label: "Cheyenne, WY, USA", lat: 41.1400, lng: -104.8202, city: "Cheyenne", region: "WY", country_code: "US" },
  { label: "Chicago, IL, USA", lat: 41.8781, lng: -87.6298, city: "Chicago", region: "IL", country_code: "US" },
  { label: "Cincinnati, OH, USA", lat: 39.1031, lng: -84.5120, city: "Cincinnati", region: "OH", country_code: "US" },
  { label: "Cleveland, OH, USA", lat: 41.4993, lng: -81.6944, city: "Cleveland", region: "OH", country_code: "US" },
  { label: "Colorado Springs, CO, USA", lat: 38.8339, lng: -104.8214, city: "Colorado Springs", region: "CO", country_code: "US" },
  { label: "Columbia, SC, USA", lat: 34.0007, lng: -81.0348, city: "Columbia", region: "SC", country_code: "US" },
  { label: "Columbus, OH, USA", lat: 39.9612, lng: -82.9988, city: "Columbus", region: "OH", country_code: "US" },
  { label: "Concord, NH, USA", lat: 43.2081, lng: -71.5376, city: "Concord", region: "NH", country_code: "US" },
  { label: "Dallas, TX, USA", lat: 32.7767, lng: -96.7970, city: "Dallas", region: "TX", country_code: "US" },
  { label: "Dearborn, MI, USA", lat: 42.3223, lng: -83.1763, city: "Dearborn", region: "MI", country_code: "US" },
  { label: "Denver, CO, USA", lat: 39.7392, lng: -104.9903, city: "Denver", region: "CO", country_code: "US" },
  { label: "Des Moines, IA, USA", lat: 41.5868, lng: -93.6250, city: "Des Moines", region: "IA", country_code: "US" },
  { label: "Detroit, MI, USA", lat: 42.3314, lng: -83.0458, city: "Detroit", region: "MI", country_code: "US" },
  { label: "Dover, DE, USA", lat: 39.1582, lng: -75.5244, city: "Dover", region: "DE", country_code: "US" },
  { label: "Durham, NC, USA", lat: 35.9940, lng: -78.8986, city: "Durham", region: "NC", country_code: "US" },
  { label: "El Paso, TX, USA", lat: 31.7619, lng: -106.4850, city: "El Paso", region: "TX", country_code: "US" },
  { label: "Fairfax, VA, USA", lat: 38.8462, lng: -77.3064, city: "Fairfax", region: "VA", country_code: "US" },
  { label: "Fort Lauderdale, FL, USA", lat: 26.1224, lng: -80.1373, city: "Fort Lauderdale", region: "FL", country_code: "US" },
  { label: "Fort Wayne, IN, USA", lat: 41.0793, lng: -85.1394, city: "Fort Wayne", region: "IN", country_code: "US" },
  { label: "Fort Worth, TX, USA", lat: 32.7555, lng: -97.3308, city: "Fort Worth", region: "TX", country_code: "US" },
  { label: "Frankfort, KY, USA", lat: 38.2009, lng: -84.8733, city: "Frankfort", region: "KY", country_code: "US" },
  { label: "Fremont, CA, USA", lat: 37.5483, lng: -121.9886, city: "Fremont", region: "CA", country_code: "US" },
  { label: "Fresno, CA, USA", lat: 36.7378, lng: -119.7871, city: "Fresno", region: "CA", country_code: "US" },
  { label: "Garland, TX, USA", lat: 32.9126, lng: -96.6389, city: "Garland", region: "TX", country_code: "US" },
  { label: "Greensboro, NC, USA", lat: 36.0726, lng: -79.7920, city: "Greensboro", region: "NC", country_code: "US" },
  { label: "Hamtramck, MI, USA", lat: 42.3927, lng: -83.0496, city: "Hamtramck", region: "MI", country_code: "US" },
  { label: "Harrisburg, PA, USA", lat: 40.2732, lng: -76.8867, city: "Harrisburg", region: "PA", country_code: "US" },
  { label: "Hartford, CT, USA", lat: 41.7658, lng: -72.6734, city: "Hartford", region: "CT", country_code: "US" },
  { label: "Helena, MT, USA", lat: 46.5891, lng: -112.0391, city: "Helena", region: "MT", country_code: "US" },
  { label: "Henderson, NV, USA", lat: 36.0395, lng: -114.9817, city: "Henderson", region: "NV", country_code: "US" },
  { label: "Honolulu, HI, USA", lat: 21.3099, lng: -157.8581, city: "Honolulu", region: "HI", country_code: "US" },
  { label: "Houston, TX, USA", lat: 29.7604, lng: -95.3698, city: "Houston", region: "TX", country_code: "US" },
  { label: "Indianapolis, IN, USA", lat: 39.7684, lng: -86.1581, city: "Indianapolis", region: "IN", country_code: "US" },
  { label: "Irvine, CA, USA", lat: 33.6846, lng: -117.8265, city: "Irvine", region: "CA", country_code: "US" },
  { label: "Irving, TX, USA", lat: 32.8140, lng: -96.9489, city: "Irving", region: "TX", country_code: "US" },
  { label: "Jackson, MS, USA", lat: 32.2988, lng: -90.1848, city: "Jackson", region: "MS", country_code: "US" },
  { label: "Jacksonville, FL, USA", lat: 30.3322, lng: -81.6557, city: "Jacksonville", region: "FL", country_code: "US" },
  { label: "Jefferson City, MO, USA", lat: 38.5767, lng: -92.1735, city: "Jefferson City", region: "MO", country_code: "US" },
  { label: "Jersey City, NJ, USA", lat: 40.7178, lng: -74.0431, city: "Jersey City", region: "NJ", country_code: "US" },
  { label: "Juneau, AK, USA", lat: 58.3019, lng: -134.4197, city: "Juneau", region: "AK", country_code: "US" },
  { label: "Kansas City, MO, USA", lat: 39.0997, lng: -94.5786, city: "Kansas City", region: "MO", country_code: "US" },
  { label: "Las Vegas, NV, USA", lat: 36.1699, lng: -115.1398, city: "Las Vegas", region: "NV", country_code: "US" },
  { label: "Lansing, MI, USA", lat: 42.7325, lng: -84.5555, city: "Lansing", region: "MI", country_code: "US" },
  { label: "Lexington, KY, USA", lat: 38.0406, lng: -84.5037, city: "Lexington", region: "KY", country_code: "US" },
  { label: "Lincoln, NE, USA", lat: 40.8136, lng: -96.7026, city: "Lincoln", region: "NE", country_code: "US" },
  { label: "Little Rock, AR, USA", lat: 34.7465, lng: -92.2896, city: "Little Rock", region: "AR", country_code: "US" },
  { label: "Long Beach, CA, USA", lat: 33.7701, lng: -118.1937, city: "Long Beach", region: "CA", country_code: "US" },
  { label: "Los Angeles, CA, USA", lat: 34.0522, lng: -118.2437, city: "Los Angeles", region: "CA", country_code: "US" },
  { label: "Louisville, KY, USA", lat: 38.2527, lng: -85.7585, city: "Louisville", region: "KY", country_code: "US" },
  { label: "Madison, WI, USA", lat: 43.0731, lng: -89.4012, city: "Madison", region: "WI", country_code: "US" },
  { label: "Memphis, TN, USA", lat: 35.1495, lng: -90.0490, city: "Memphis", region: "TN", country_code: "US" },
  { label: "Mesa, AZ, USA", lat: 33.4152, lng: -111.8315, city: "Mesa", region: "AZ", country_code: "US" },
  { label: "Miami, FL, USA", lat: 25.7617, lng: -80.1918, city: "Miami", region: "FL", country_code: "US" },
  { label: "Milwaukee, WI, USA", lat: 43.0389, lng: -87.9065, city: "Milwaukee", region: "WI", country_code: "US" },
  { label: "Minneapolis, MN, USA", lat: 44.9778, lng: -93.2650, city: "Minneapolis", region: "MN", country_code: "US" },
  { label: "Montgomery, AL, USA", lat: 32.3668, lng: -86.3000, city: "Montgomery", region: "AL", country_code: "US" },
  { label: "Montpelier, VT, USA", lat: 44.2601, lng: -72.5754, city: "Montpelier", region: "VT", country_code: "US" },
  { label: "Naperville, IL, USA", lat: 41.7508, lng: -88.1535, city: "Naperville", region: "IL", country_code: "US" },
  { label: "Nashville, TN, USA", lat: 36.1627, lng: -86.7816, city: "Nashville", region: "TN", country_code: "US" },
  { label: "New Haven, CT, USA", lat: 41.3083, lng: -72.9279, city: "New Haven", region: "CT", country_code: "US" },
  { label: "New Orleans, LA, USA", lat: 29.9511, lng: -90.0715, city: "New Orleans", region: "LA", country_code: "US" },
  { label: "New York, NY, USA", lat: 40.7128, lng: -74.0060, city: "New York", region: "NY", country_code: "US" },
  { label: "Newark, NJ, USA", lat: 40.7357, lng: -74.1724, city: "Newark", region: "NJ", country_code: "US" },
  { label: "Norfolk, VA, USA", lat: 36.8508, lng: -76.2859, city: "Norfolk", region: "VA", country_code: "US" },
  { label: "Oakland, CA, USA", lat: 37.8044, lng: -122.2712, city: "Oakland", region: "CA", country_code: "US" },
  { label: "Oklahoma City, OK, USA", lat: 35.4676, lng: -97.5164, city: "Oklahoma City", region: "OK", country_code: "US" },
  { label: "Olympia, WA, USA", lat: 47.0379, lng: -122.9007, city: "Olympia", region: "WA", country_code: "US" },
  { label: "Omaha, NE, USA", lat: 41.2565, lng: -95.9345, city: "Omaha", region: "NE", country_code: "US" },
  { label: "Orlando, FL, USA", lat: 28.5383, lng: -81.3792, city: "Orlando", region: "FL", country_code: "US" },
  { label: "Paterson, NJ, USA", lat: 40.9168, lng: -74.1718, city: "Paterson", region: "NJ", country_code: "US" },
  { label: "Philadelphia, PA, USA", lat: 39.9526, lng: -75.1652, city: "Philadelphia", region: "PA", country_code: "US" },
  { label: "Phoenix, AZ, USA", lat: 33.4484, lng: -112.0740, city: "Phoenix", region: "AZ", country_code: "US" },
  { label: "Pierre, SD, USA", lat: 44.3683, lng: -100.3510, city: "Pierre", region: "SD", country_code: "US" },
  { label: "Pittsburgh, PA, USA", lat: 40.4406, lng: -79.9959, city: "Pittsburgh", region: "PA", country_code: "US" },
  { label: "Plano, TX, USA", lat: 33.0198, lng: -96.6989, city: "Plano", region: "TX", country_code: "US" },
  { label: "Portland, OR, USA", lat: 45.5152, lng: -122.6784, city: "Portland", region: "OR", country_code: "US" },
  { label: "Providence, RI, USA", lat: 41.8240, lng: -71.4128, city: "Providence", region: "RI", country_code: "US" },
  { label: "Raleigh, NC, USA", lat: 35.7796, lng: -78.6382, city: "Raleigh", region: "NC", country_code: "US" },
  { label: "Reno, NV, USA", lat: 39.5296, lng: -119.8138, city: "Reno", region: "NV", country_code: "US" },
  { label: "Richmond, VA, USA", lat: 37.5407, lng: -77.4360, city: "Richmond", region: "VA", country_code: "US" },
  { label: "Riverside, CA, USA", lat: 33.9806, lng: -117.3755, city: "Riverside", region: "CA", country_code: "US" },
  { label: "Rochester, NY, USA", lat: 43.1566, lng: -77.6088, city: "Rochester", region: "NY", country_code: "US" },
  { label: "Sacramento, CA, USA", lat: 38.5816, lng: -121.4944, city: "Sacramento", region: "CA", country_code: "US" },
  { label: "Saint Paul, MN, USA", lat: 44.9537, lng: -93.0900, city: "Saint Paul", region: "MN", country_code: "US" },
  { label: "Salem, OR, USA", lat: 44.9429, lng: -123.0351, city: "Salem", region: "OR", country_code: "US" },
  { label: "Salt Lake City, UT, USA", lat: 40.7608, lng: -111.8910, city: "Salt Lake City", region: "UT", country_code: "US" },
  { label: "San Antonio, TX, USA", lat: 29.4241, lng: -98.4936, city: "San Antonio", region: "TX", country_code: "US" },
  { label: "San Bernardino, CA, USA", lat: 34.1083, lng: -117.2898, city: "San Bernardino", region: "CA", country_code: "US" },
  { label: "San Diego, CA, USA", lat: 32.7157, lng: -117.1611, city: "San Diego", region: "CA", country_code: "US" },
  { label: "San Francisco, CA, USA", lat: 37.7749, lng: -122.4194, city: "San Francisco", region: "CA", country_code: "US" },
  { label: "San Jose, CA, USA", lat: 37.3382, lng: -121.8863, city: "San Jose", region: "CA", country_code: "US" },
  { label: "Santa Ana, CA, USA", lat: 33.7455, lng: -117.8677, city: "Santa Ana", region: "CA", country_code: "US" },
  { label: "Santa Fe, NM, USA", lat: 35.6870, lng: -105.9378, city: "Santa Fe", region: "NM", country_code: "US" },
  { label: "Savannah, GA, USA", lat: 32.0809, lng: -81.0912, city: "Savannah", region: "GA", country_code: "US" },
  { label: "Scottsdale, AZ, USA", lat: 33.4942, lng: -111.9261, city: "Scottsdale", region: "AZ", country_code: "US" },
  { label: "Seattle, WA, USA", lat: 47.6062, lng: -122.3321, city: "Seattle", region: "WA", country_code: "US" },
  { label: "Springfield, IL, USA", lat: 39.7817, lng: -89.6501, city: "Springfield", region: "IL", country_code: "US" },
  { label: "St. Louis, MO, USA", lat: 38.6270, lng: -90.1994, city: "St. Louis", region: "MO", country_code: "US" },
  { label: "St. Petersburg, FL, USA", lat: 27.7676, lng: -82.6403, city: "St. Petersburg", region: "FL", country_code: "US" },
  { label: "Stamford, CT, USA", lat: 41.0534, lng: -73.5387, city: "Stamford", region: "CT", country_code: "US" },
  { label: "Sterling Heights, MI, USA", lat: 42.5803, lng: -83.0302, city: "Sterling Heights", region: "MI", country_code: "US" },
  { label: "Stockton, CA, USA", lat: 37.9577, lng: -121.2908, city: "Stockton", region: "CA", country_code: "US" },
  { label: "Sunnyvale, CA, USA", lat: 37.3688, lng: -122.0363, city: "Sunnyvale", region: "CA", country_code: "US" },
  { label: "Syracuse, NY, USA", lat: 43.0481, lng: -76.1474, city: "Syracuse", region: "NY", country_code: "US" },
  { label: "Tallahassee, FL, USA", lat: 30.4383, lng: -84.2807, city: "Tallahassee", region: "FL", country_code: "US" },
  { label: "Tampa, FL, USA", lat: 27.9506, lng: -82.4572, city: "Tampa", region: "FL", country_code: "US" },
  { label: "Topeka, KS, USA", lat: 39.0473, lng: -95.6752, city: "Topeka", region: "KS", country_code: "US" },
  { label: "Trenton, NJ, USA", lat: 40.2206, lng: -74.7597, city: "Trenton", region: "NJ", country_code: "US" },
  { label: "Tucson, AZ, USA", lat: 32.2226, lng: -110.9747, city: "Tucson", region: "AZ", country_code: "US" },
  { label: "Tulsa, OK, USA", lat: 36.1540, lng: -95.9928, city: "Tulsa", region: "OK", country_code: "US" },
  { label: "Virginia Beach, VA, USA", lat: 36.8529, lng: -75.9780, city: "Virginia Beach", region: "VA", country_code: "US" },
  { label: "Washington, DC, USA", lat: 38.9072, lng: -77.0369, city: "Washington", region: "DC", country_code: "US" },
  { label: "Wichita, KS, USA", lat: 37.6872, lng: -97.3301, city: "Wichita", region: "KS", country_code: "US" },
  { label: "Worcester, MA, USA", lat: 42.2626, lng: -71.8023, city: "Worcester", region: "MA", country_code: "US" },
  { label: "Yonkers, NY, USA", lat: 40.9312, lng: -73.8987, city: "Yonkers", region: "NY", country_code: "US" },

  // International — top halal-density / commonly-searched cities. Lat/
  // lng centered on the city's downtown reference point.
  { label: "Dubai, United Arab Emirates", lat: 25.2048, lng: 55.2708, city: "Dubai", region: null, country_code: "AE" },
  { label: "Istanbul, Türkiye", lat: 41.0082, lng: 28.9784, city: "Istanbul", region: null, country_code: "TR" },
  { label: "Karachi, Pakistan", lat: 24.8607, lng: 67.0011, city: "Karachi", region: null, country_code: "PK" },
  { label: "Lahore, Pakistan", lat: 31.5204, lng: 74.3587, city: "Lahore", region: null, country_code: "PK" },
  { label: "London, United Kingdom", lat: 51.5074, lng: -0.1278, city: "London", region: null, country_code: "GB" },
  { label: "Mumbai, India", lat: 19.0760, lng: 72.8777, city: "Mumbai", region: null, country_code: "IN" },
  { label: "Toronto, Canada", lat: 43.6532, lng: -79.3832, city: "Toronto", region: null, country_code: "CA" },
];

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const MAX_RESULTS = 5;

/**
 * Local prefix / substring search over the curated city list.
 *
 * Matching strategy (simple but effective for a 150-row dataset):
 *   1. Lowercase + trim the query.
 *   2. Walk the city list once. For each city, score:
 *        * starts-with on the canonical "city" name → 3
 *        * starts-with on the full label             → 2
 *        * contains anywhere in label                → 1
 *      Rows with score 0 are dropped.
 *   3. Sort descending by score, then alphabetically by label so
 *      ties surface in a deterministic order.
 *   4. Cap at ``MAX_RESULTS`` (5) — the picker dialog renders a
 *      compact list, not a results page.
 *
 * O(n) over ~150 entries is sub-millisecond; no need for a fancier
 * trie / fuzzy matcher at this scale.
 */
export function searchLocalCities(rawQuery: string): ForwardGeocodeMatch[] {
  const q = rawQuery.trim().toLowerCase();
  if (q.length === 0) return [];

  type Scored = { city: ForwardGeocodeMatch; score: number };
  const scored: Scored[] = [];

  for (const city of CITIES) {
    const label = city.label.toLowerCase();
    const cityName = (city.city ?? "").toLowerCase();
    let score = 0;
    if (cityName && cityName.startsWith(q)) {
      score = 3;
    } else if (label.startsWith(q)) {
      score = 2;
    } else if (label.includes(q)) {
      score = 1;
    }
    if (score > 0) {
      scored.push({ city, score });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.city.label.localeCompare(b.city.label);
  });

  return scored.slice(0, MAX_RESULTS).map((s) => s.city);
}
