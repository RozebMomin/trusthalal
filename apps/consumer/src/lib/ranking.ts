/**
 * Ranking a place by its Trust Halal rating.
 *
 * ## Why this isn't just `sort by average`
 *
 * A raw average makes one 5.0 review beat fifty 4.8s. That's both wrong —
 * one person's opinion is weaker evidence than fifty — and trivially gameable:
 * a single review from a friend puts a restaurant at the top of every search.
 *
 * The first attempt at this was a hard floor: only places with 3+ reviews were
 * rankable. That's the right instinct sized for the wrong platform. On a
 * catalog where exactly one place had exactly one review, *every* place failed
 * the gate, the comparator fell through to distance, and "Top rated on Trust
 * Halal" silently produced the same list as "Closest first". A guard that
 * turns the feature off until some far-off future isn't a guard, it's a bug.
 *
 * ## What this does instead
 *
 * The standard fix — a Bayesian weighted average, the same shape IMDb uses for
 * the Top 250. Each place's average is shrunk toward a neutral prior, weighted
 * by how many reviews back it up:
 *
 *     score = (v / (v + m)) * R + (m / (v + m)) * C
 *
 * where R is the place's average, v its review count, C the prior mean, and m
 * the prior weight. With few reviews the score sits near C; as reviews
 * accumulate it converges on R. There's no cutoff, so the sort does something
 * visible from the very first review while still refusing to let that review
 * outrank a well-evidenced score.
 *
 * Worked examples at the constants below:
 *
 *     5.0 from   1 review  -> 3.75   (a friend's review; ranks low)
 *     4.0 from  10 reviews -> 3.83   (beats it, on 10x the evidence)
 *     4.8 from  50 reviews -> 4.68   (beats both)
 *
 * ## Deliberately NOT self-tuning
 *
 * The textbook choice for C is the catalog-wide mean. That degenerates here:
 * with one rated place, the catalog mean *is* that place's rating, the
 * shrinkage becomes a no-op, and the bug comes back wearing a statistics
 * costume. A fixed prior is predictable, has no data dependency, and is
 * honest about the fact that we don't yet know what our catalog's average
 * looks like. Revisit once there's enough volume for a mean to mean something.
 */

/**
 * Prior mean — the score assumed for a place we know nothing about.
 *
 * 3.5 rather than 3.0: restaurant rating distributions skew high, so the
 * midpoint of the scale is not the midpoint of real behavior. A place has to
 * beat "probably fine" to climb, not "actively bad".
 */
export const PRIOR_MEAN = 3.5;

/**
 * Prior weight, in units of reviews — how much evidence it takes before a
 * place's own average outweighs the prior.
 *
 * At m = 5, the 5th review is the point where the place's average carries half
 * the score. Small enough that early reviews visibly move the ranking, large
 * enough that a single planted 5.0 doesn't clear a genuinely well-reviewed
 * restaurant.
 */
export const PRIOR_WEIGHT = 5;

export type Rateable = {
  review_rating_avg?: number | null;
  review_count?: number;
};

/**
 * Bayesian weighted score for a place. Returns the bare prior for anything
 * unrated, so callers never have to special-case nulls.
 */
export function trustHalalScore(place: Rateable): number {
  const v = place.review_count ?? 0;
  const r = place.review_rating_avg;
  if (v <= 0 || r == null) return PRIOR_MEAN;
  return (v / (v + PRIOR_WEIGHT)) * r + (PRIOR_WEIGHT / (v + PRIOR_WEIGHT)) * PRIOR_MEAN;
}

/**
 * Comparator for "Top rated on Trust Halal". Negative = `a` ranks first.
 *
 * Rated places always outrank unrated ones, ahead of any score comparison.
 * Without that, a single 2-star review scores below the prior and would sink
 * a place *beneath* restaurants nobody has reviewed at all — technically the
 * correct posterior, but nonsense to read in a list titled "top rated". The
 * unrated tail keeps its distance ordering, so it still reads as a useful
 * list rather than a shuffled one.
 *
 * `distanceMeters` is the final tie-break and is optional: text search has no
 * geo center, in which case ties resolve to the incoming order.
 */
export function compareByTrustHalalRating(
  a: { place: Rateable; distanceMeters?: number },
  b: { place: Rateable; distanceMeters?: number },
): number {
  const ratedA = (a.place.review_count ?? 0) > 0;
  const ratedB = (b.place.review_count ?? 0) > 0;
  if (ratedA !== ratedB) return ratedA ? -1 : 1;

  if (ratedA && ratedB) {
    const sa = trustHalalScore(a.place);
    const sb = trustHalalScore(b.place);
    if (sb !== sa) return sb - sa;
    // Equal scores: more reviews is more confidence in the same number.
    const ca = a.place.review_count ?? 0;
    const cb = b.place.review_count ?? 0;
    if (cb !== ca) return cb - ca;
  }

  return (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0);
}

/**
 * Comparator for "Top rated on Google".
 *
 * No shrinkage here, on purpose. These counts arrive in the hundreds or
 * thousands, so the prior would be noise against them — and it isn't our
 * average to adjust. We display Google's number; we rank by Google's number.
 */
export function compareByGoogleRating(
  a: { place: { google_rating?: number | null; google_rating_count?: number | null }; distanceMeters?: number },
  b: { place: { google_rating?: number | null; google_rating_count?: number | null }; distanceMeters?: number },
): number {
  const ra = a.place.google_rating ?? -1;
  const rb = b.place.google_rating ?? -1;
  if (rb !== ra) return rb - ra;
  const ca = a.place.google_rating_count ?? 0;
  const cb = b.place.google_rating_count ?? 0;
  if (cb !== ca) return cb - ca;
  return (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0);
}
