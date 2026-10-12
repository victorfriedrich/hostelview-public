/** Types and fetch helper for the Hostelview API (backend/app/api.py). */

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export const ASPECTS = ["security", "location", "staff", "atmosphere", "cleanliness", "facilities", "value"] as const;
export type Aspect = (typeof ASPECTS)[number];
/** Aspect scores on Hostelworld's 0-10 scale. */
export type Scores = Record<Aspect, number | null>;

export interface City {
  slug: string;
  name: string;
  country: string;
  lat: number | null;
  lon: number | null;
  hostelCount: number;
  reviewedHostelCount: number;
  avgRating: number | null;
  avgAtmosphere: number | null;
  avgDormPrice: number | null;
  topRating: number | null;
  topDormPrice: number | null;
}

export interface Hostel {
  id: number;
  name: string;
  city: { slug: string; name: string; country: string };
  /** Hostelworld's published scores. */
  /** Dropped off Hostelworld: hidden from city lists, kept here for its reviews. */
  delisted: boolean;
  hostelworld: { rating: number | null; reviewCount: number | null; scores: Scores };
  /** Averages over the reviews stored for this hostel. */
  guests: { rating: number | null; reviewCount: number; scores: Scores; firstReview: string; lastReview: string } | null;
  /** Jev's calibrated ratings, on the same 2-10 range as the guest scores. */
  jev: {
    model: string;
    reviewCount: number;
    ratedAt: string;
    rating: number | null;
    scores: Scores & { bathrooms: number | null; party: number | null; social: number | null };
  } | null;
  demographics: {
    gender: Record<string, number>;
    age: Record<string, number>;
    nationalities: Record<string, number>;
    reviewerExperienceMedian: number | null;
  } | null;
  /** Reviews per kind of traveller; see Segments. */
  segments: Segments | null;
  price: { dormFrom: number | null; privateFrom: number | null; scrapedOn: string } | null;
}

export const SEGMENT_VALUES = {
  traveller: ["solo_female", "solo_male", "couple", "group"],
  age: ["18-24", "25-30", "31-40", "41+"],
  /** Hostelworld reviews the guest has written: 0-2, 3-10, 11+. */
  experience: ["new", "regular", "seasoned"],
} as const;
export type SegmentDim = keyof typeof SEGMENT_VALUES;
export type SegmentValue<D extends SegmentDim = SegmentDim> = (typeof SEGMENT_VALUES)[D][number];

/** Aspects the traveller can weigh more (the API takes any of ASPECTS). */
export const WEIGHED_ASPECTS = ["cleanliness", "facilities", "atmosphere"] as const satisfies readonly Aspect[];
export type WeighedAspect = (typeof WEIGHED_ASPECTS)[number];

/** How many of a hostel's reviews came from each kind of traveller, per dimension. */
export type Segments = { [D in SegmentDim]?: Partial<Record<SegmentValue<D>, number>> };

/** A hostel as the name search returns it. */
export interface HostelRef {
  id: number;
  name: string;
  city: { slug: string; name: string; country: string };
  /** From the name search: false when the hostel has no stored reviews, so its guests can't be matched. */
  comparable?: boolean;
}

/** GET /hostels/{id}/also-stayed: the hostels closest to this one in the hostel graph (backend/app/graph.py). */
export interface AlsoStayed {
  hostels: {
    id: number;
    name: string;
    city: { slug: string; name: string; country: string };
    guestRating: number | null;
    reviewCount: number;
    /** Guests who rated both hostels 9.4+, when directly linked; else the hostel it's reached through. */
    guests: number | null;
    via: { id: number; name: string } | null;
  }[];
}

/** Why a hostel is close to a liked or disliked one in the hostel graph. */
export interface GraphLink {
  anchor: number;
  guests?: number;
  via?: { id: number; name: string };
}

/** The liked (or disliked) hostel most like this one in crowd and scores. */
export interface Alike {
  anchor: number;
}

/** GET /recommendations: hostels ranked for the weighed aspects and liked hostels. */
export interface Recommendations {
  /** Hostels with enough reviews to rank inside the requested area. */
  inView: number;
  hostels: {
    id: number;
    name: string;
    city: { slug: string; name: string; country: string; lat: number | null; lon: number | null };
    /** Expected rating, 0-10: the guest rating blended with the weighed aspects. */
    rating: number;
    guestRating: number;
    reviewCount: number;
    dormFrom: number | null;
    /** The weighed aspects: the guest score, and how far it sits above the typical hostel's after shrinking. */
    aspects: { aspect: Aspect; score: number | null; vsTypical: number }[];
    /** Rating points added for closeness to liked hostels, minus those for closeness to disliked ones. */
    bonus: number;
    /** The liked (or disliked) hostel it's closest to, and how: guests who rated both 9.4+, or via another hostel. */
    liked: GraphLink | null;
    disliked: GraphLink | null;
    likedAlike: Alike | null;
    dislikedAlike: Alike | null;
  }[];
  /** Liked or disliked hostels neither in the hostel graph nor with enough reviews to compare: they carry no signal. */
  unmatched: number[];
}

export interface History {
  windowDates: number;
  points: { date: string; reviews: number; scores: Record<"overall" | Aspect, number | null> }[];
  volumeBlockDays: number;
  volume: { start: string; reviews: number }[];
}

export interface Review {
  id: number;
  date: string;
  text: string;
  /** The guest's overall score, 0-10. */
  score: number | null;
  groupType: string | null;
  age: string | null;
  nationality: string | null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {}
    throw new ApiError(res.status, `API error: ${res.status} - ${detail}`);
  }
  return res.json();
}
