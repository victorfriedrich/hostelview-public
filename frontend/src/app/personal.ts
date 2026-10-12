/**
 * Who stays where: crowd tags for the city list and the For you tab's recommendations, and
 * the For you ranking, computed by GET /recommendations (backend/app/recommend.py).
 */
import { useEffect, useState } from "react";
import { getJson, SEGMENT_VALUES, type Aspect, type Hostel, type Recommendations, type SegmentDim } from "./api";
import type { Preferences } from "./hooks/usePreferences";
import { countryName } from "./listings/[city]/[id]/sections";

export const DIMS = Object.keys(SEGMENT_VALUES) as SegmentDim[];

export const ASPECT_LABELS: Record<Aspect, string> = {
  security: "Security", location: "Location", staff: "Staff", atmosphere: "Atmosphere",
  cleanliness: "Cleanliness", facilities: "Facilities", value: "Value",
};

/** How many of the hostel's reviews came from one segment. */
const segment = (h: Hostel, dim: SegmentDim, value: string): number =>
  (h.segments?.[dim] as Record<string, number> | undefined)?.[value] ?? 0;

/* ── tags ─────────────────────────────────────────────────────────────────── */

export type Tag = {
  label: string;
  /** crowd: who stays there; quality: a strength or weak spot. */
  kind: "crowd" | "quality";
  title?: string;
};

const MIN_TAGGED_REVIEWS = 30;
const MAX_CROWD_TAGS = 3;

/** Segments of one dimension as shares of the hostel's reviews that have that dimension. */
function shares(h: Hostel, dim: SegmentDim) {
  const segs = (h.segments?.[dim] ?? {}) as Record<string, number>;
  const total = Object.values(segs).reduce((a, n) => a + n, 0);
  return { total, share: (v: string) => (total ? (segs[v] ?? 0) / total : 0) };
}

function nationalityShares(h: Hostel) {
  const counts = Object.entries(h.demographics?.nationalities ?? {});
  const total = counts.reduce((a, [, n]) => a + n, 0);
  return { total, counts: counts.map(([c, n]) => [c, total ? n / total : 0] as const) };
}

/**
 * What sets each hostel's crowd apart from the city's: segments a hostel has clearly more of
 * than the city's hostels together (by share and by lift over the city's share), strongest first.
 */
export function crowdTags(hostels: Hostel[]): Map<Hostel, Tag[]> {
  // Pooled shares over the city.
  const pooled = new Map<string, number>();
  for (const dim of DIMS) {
    const counts = SEGMENT_VALUES[dim].map((v) => hostels.reduce((a, h) => a + segment(h, dim, v), 0));
    const total = counts.reduce((a, b) => a + b, 0);
    SEGMENT_VALUES[dim].forEach((v, i) => pooled.set(`${dim}:${v}`, total ? counts[i] / total : 0));
  }
  const natCounts = new Map<string, number>();
  let natTotal = 0;
  for (const h of hostels) {
    for (const [c, n] of Object.entries(h.demographics?.nationalities ?? {})) {
      natCounts.set(c, (natCounts.get(c) ?? 0) + n);
      natTotal += n;
    }
  }
  // "International": an effective number of nationalities (1 / Σ share²) in the city's top ~15%.
  const diversity = new Map(hostels.map((h) => {
    const { total, counts } = nationalityShares(h);
    return [h, total >= MIN_TAGGED_REVIEWS ? 1 / counts.reduce((a, [, p]) => a + p * p, 0) : null] as const;
  }));
  const diversities = [...diversity.values()].filter((d): d is number => d != null).sort((a, b) => a - b);
  const diverseCutoff = diversities.length >= 7 ? diversities[Math.floor(diversities.length * 0.85)] : Infinity;

  // [dim, segments counted together, label, minimum share, minimum lift]
  const RULES: [SegmentDim, string[], string, number, number][] = [
    ["traveller", ["solo_female"], "Solo women", 0.2, 1.35],
    ["traveller", ["solo_male"], "Solo men", 0.35, 1.35],
    ["traveller", ["couple"], "Couples", 0.2, 1.4],
    ["traveller", ["group"], "Groups", 0.3, 1.4],
    ["age", ["18-24"], "Young crowd", 0.5, 1.25],
    ["age", ["25-30"], "25–30 crowd", 0.45, 1.25],
    ["age", ["31-40", "41+"], "31+ crowd", 0.3, 1.4],
    ["experience", ["seasoned"], "Seasoned travellers", 0.3, 1.3],
    ["experience", ["new"], "Newer travellers", 0.6, 1.2],
  ];

  return new Map(hostels.map((h) => {
    const found: (Tag & { lift: number })[] = [];
    for (const [dim, values, label, minShare, minLift] of RULES) {
      const { total, share } = shares(h, dim);
      if (total < MIN_TAGGED_REVIEWS) continue;
      const s = values.reduce((a, v) => a + share(v), 0);
      const city = values.reduce((a, v) => a + (pooled.get(`${dim}:${v}`) ?? 0), 0);
      const lift = city ? s / city : 0;
      if (s >= minShare && lift >= minLift) {
        found.push({ label, kind: "crowd", lift, title: `${Math.round(s * 100)}% of reviews here, ${Math.round(city * 100)}% across the city` });
      }
    }
    const { total, counts } = nationalityShares(h);
    if (total >= MIN_TAGGED_REVIEWS && natTotal) {
      const [code, share] = counts.reduce((m, c) => (c[1] > m[1] ? c : m), ["", 0] as readonly [string, number]);
      const city = (natCounts.get(code) ?? 0) / natTotal;
      if (code && share >= 0.2 && city && share / city >= 1.8) {
        found.push({ label: `Many from ${countryName(code)}`, kind: "crowd", lift: share / city,
          title: `${Math.round(share * 100)}% of reviews here, ${Math.round(city * 100)}% across the city` });
      }
    }
    const d = diversity.get(h);
    if (d != null && d >= diverseCutoff) {
      found.push({ label: "International", kind: "crowd", lift: 1.3, title: "Among the city's most varied mix of nationalities" });
    }
    found.sort((a, b) => b.lift - a.lift);
    return [h, found.slice(0, MAX_CROWD_TAGS).map(({ label, kind, title }) => ({ label, kind, title }))];
  }));
}

/** [west, south, east, north] in degrees. */
export type BBox = [west: number, south: number, east: number, north: number];

/** GET /recommendations for the weighed aspects, liked hostels and map area; null while loading. */
export function useRecommendations(prefs: Preferences, bbox: BBox | null, enabled: boolean) {
  const params = new URLSearchParams();
  const weighed = Object.entries(prefs.aspects).filter(([, w]) => w);
  if (weighed.length) params.set("aspects", weighed.map(([a, w]) => `${a}:${w}`).join(","));
  if (prefs.liked.length) params.set("liked", prefs.liked.map((h) => h.id).join(","));
  if (prefs.disliked.length) params.set("disliked", prefs.disliked.map((h) => h.id).join(","));
  // Rounded so small pans reuse the cached response.
  if (bbox) params.set("bbox", bbox.map((x) => x.toFixed(1)).join(","));
  const query = params.toString();

  const [data, setData] = useState<{ query: string; result: Recommendations } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      getJson<Recommendations>(`/recommendations?${query}`)
        .then((result) => { if (!cancelled) { setData({ query, result }); setError(null); } })
        .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, enabled]);

  return { result: data?.query === query ? data.result : null, stale: data?.result ?? null, error };
}
