"use client";

import React, { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import HostelRatingCard from "@/app/HostelRatingCardComponent";
import { Nav } from "../Nav";
import { useHostelData } from "@/app/hooks/useHostelData";
import type { Aspect, Hostel } from "@/app/api";
import { crowdTags, type Tag } from "@/app/personal";
import { guestScore } from "./[id]/sections";

/* -------------------------------------------------------------------------- */
/*                                   SORTING                                  */
/* -------------------------------------------------------------------------- */

// Each option orders by one number; hostels without it go last.
const SORT_OPTIONS: { id: string; label: string; value: (h: Hostel) => number | null; desc: boolean }[] = [
  { id: "rating", label: "Rating", value: (h) => positive(guestScore(h, "overall")), desc: true },
  { id: "llm", label: "LLM rating", value: (h) => h.jev?.rating ?? null, desc: true },
  { id: "age", label: "Youngest crowd", value: (h) => youngShare(h), desc: true },
  { id: "price", label: "Price", value: (h) => positive(h.price?.dormFrom), desc: false },
  { id: "atmosphere", label: "Atmosphere", value: (h) => aspectScore(h, "atmosphere", "atmosphere")?.value ?? null, desc: true },
];

const positive = (x: unknown) => {
  const n = Number(x);
  return x != null && Number.isFinite(n) && n > 0 ? n : null;
};

const ageBuckets = (h: Hostel) => Object.entries(h.demographics?.age ?? {});

/** The age range most reviewers fall in, e.g. "18-24". */
const largestAgeBucket = (h: Hostel) => {
  const entries = ageBuckets(h);
  return entries.length ? entries.reduce((m, c) => (c[1] > m[1] ? c : m))[0] : null;
};

/** Share of reviewers aged 18–24. */
const youngShare = (h: Hostel) => {
  const entries = ageBuckets(h);
  const total = entries.reduce((s, [, c]) => s + c, 0);
  return total ? (h.demographics?.age["18-24"] ?? 0) / total : null;
};

const SortingDropdown = ({
  onSortChange,
  currentSort,
}: {
  onSortChange: (id: string) => void;
  currentSort: string;
}) => (
  <label className="flex items-baseline gap-2 text-[13px]">
    <span style={{ color: "var(--muted)" }}>Sort by</span>
    <select
      value={currentSort}
      onChange={(e) => onSortChange(e.target.value)}
      className="cursor-pointer bg-transparent outline-none"
      style={{ color: "var(--ink)", fieldSizing: "content" } as React.CSSProperties}
    >
      {SORT_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  </label>
);

/* -------------------------------------------------------------------------- */
/*                                    TAGS                                    */
/* -------------------------------------------------------------------------- */

type JevKey = keyof NonNullable<Hostel["jev"]>["scores"];

/** An aspect score on the guest 2–10 scale: Jev's where the hostel has been rated, else the guests'. */
const aspectScore = (h: Hostel, jevKey: JevKey, guestKey: Aspect | null) => {
  const jev = h.jev?.scores[jevKey];
  if (jev != null) return { value: jev, jev: true };
  const guest = guestKey ? positive(guestScore(h, guestKey)) : null;
  return guest != null ? { value: guest, jev: false } : null;
};

/** Aspects flagged when a hostel is in the city's bottom third: [tag, Jev key, guest key]. */
const WEAK_SPOTS: [string, JevKey, Aspect | null][] = [
  ["Clean", "cleanliness", "cleanliness"],
  ["Facilities", "facilities", "facilities"],
  ["Bathrooms", "bathrooms", null], // Jev only
];

/** "Social" on the city's three most social hostels; "↓" tags where a hostel is in the city's bottom third. */
function cityTags(hostels: Hostel[]) {
  const scored = (jevKey: JevKey, guestKey: Aspect | null) =>
    new Map(hostels.map((h) => [h, aspectScore(h, jevKey, guestKey)]));

  // Guests don't rate "social"; their atmosphere score is the closest stand-in.
  const social = scored("social", "atmosphere");
  const mostSocial = new Set(
    [...social].filter(([, s]) => s).sort((a, b) => b[1]!.value - a[1]!.value).slice(0, 3).map(([h]) => h),
  );

  const weak = WEAK_SPOTS.map(([label, jevKey, guestKey]) => {
    const scores = scored(jevKey, guestKey);
    const values = [...scores.values()].filter((s) => s != null).map((s) => s!.value).sort((a, b) => a - b);
    // Below the value a third of the way up the city's scores.
    const cutoff = values.length >= 3 ? values[Math.floor(values.length / 3)] : null;
    return { label, scores, cutoff };
  });

  return new Map(
    hostels.map((h) => {
      const tags: Tag[] = [];
      const source = (jev: boolean) => (jev ? "From LLM ratings" : "From guest ratings");
      if (mostSocial.has(h)) tags.push({ label: "Social", kind: "quality", title: source(social.get(h)!.jev) });
      for (const w of weak) {
        const s = w.scores.get(h);
        if (s && w.cutoff != null && s.value < w.cutoff) tags.push({ label: `${w.label} ↓`, kind: "quality", title: source(s.jev) });
      }
      return [h, tags];
    }),
  );
}

/* -------------------------------------------------------------------------- */
/*                               MAIN PAGE BODY                               */
/* -------------------------------------------------------------------------- */

const CityHostelsPage = () => {
  const params = useParams();
  const city = String(params.city || "");
  const decodedCity = decodeURIComponent(city);
  const { hostels, loading, error, notFound } = useHostelData(city);
  const cityLabel = hostels[0]?.city.name ?? decodedCity.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const [sortBy, setSortBy] = useState<string>("rating");

  /* --------------------------- SORTED HOSTEL LIST -------------------------- */
  const sortedHostels = useMemo(() => {
    const option = SORT_OPTIONS.find((o) => o.id === sortBy)!;
    return (hostels ?? [])
      .map((h) => ({ h, v: option.value(h) }))
      .sort((a, b) => {
        if (a.v == null || b.v == null) return a.v == null ? (b.v == null ? 0 : 1) : -1;
        return option.desc ? b.v - a.v : a.v - b.v;
      })
      .map(({ h }) => h);
  }, [hostels, sortBy]);

  const tagsByHostel = useMemo(() => cityTags(hostels ?? []), [hostels]);
  // Who stays there first, then weak spots.
  const crowdByHostel = useMemo(() => crowdTags(hostels ?? []), [hostels]);

  /* ------------------------------ LOAD STATES ----------------------------- */

  const shell = (children: React.ReactNode) => (
    <div className="lux min-h-screen">
      <Nav city={city} cityLabel={cityLabel} />
      <main className="mx-auto w-full max-w-[1080px] px-4 pb-16 sm:px-6">{children}</main>
    </div>
  );

  const message = (title: string, body?: string) => shell(
    <section className="pt-14 sm:pt-20">
      <div className="eyebrow mb-3">Hostels</div>
      <h1 className="display text-[40px] sm:text-[52px]">{title}</h1>
      {body && <p className="mt-4 max-w-[34rem] text-[15px]" style={{ color: "var(--ink-2)" }}>{body}</p>}
    </section>,
  );

  if (loading) {
    return shell(
      <div aria-busy className="pt-14 sm:pt-20">
        <div className="h-[11px] w-24 animate-pulse rounded-full" style={{ background: "var(--hair)" }} />
        <div className="mt-4 h-[48px] w-[min(360px,100%)] animate-pulse rounded-[6px]" style={{ background: "var(--hair)" }} />
        <div className="card mt-10 h-[420px] animate-pulse" />
      </div>,
    );
  }

  if (notFound) return message("City not found", `We don't have hostels for ${cityLabel} yet.`);
  if (error) return message("Couldn't load hostels", error);

  if (!hostels || hostels.length === 0) {
    return message(cityLabel, "No hostels found here yet.");
  }

  /* ------------------------------------------------------------------------ */
  /*                                RENDER PAGE                               */
  /* ------------------------------------------------------------------------ */

  return shell(
    <>
      <section className="rise flex flex-wrap items-end justify-between gap-6 pb-8 pt-10 sm:pt-14">
        <div className="min-w-0">
          <div className="eyebrow mb-3">{hostels.length} hostels</div>
          <h1 className="display text-[40px] sm:text-[52px]">{cityLabel}</h1>
        </div>
        <SortingDropdown currentSort={sortBy} onSortChange={setSortBy} />
      </section>

      <div className="card rise overflow-hidden px-4 sm:px-5" style={{ animationDelay: "0.06s" }}>
        <div className="-mt-px">
            {sortedHostels.map((h) => {
              /* ------------------------- RATING & DEMOS ------------------------ */
              const rating = positive(guestScore(h, "overall"));
              const ratings = {
                hostelworld: rating != null ? rating.toFixed(1) : "N/A",
                reviewCount: h.hostelworld.reviewCount ?? undefined,
              };

              const age = largestAgeBucket(h)?.replace("-", "–") ?? null;

              const tags = [...(crowdByHostel.get(h) ?? []), ...(tagsByHostel.get(h) ?? [])].slice(0, 4);

              /* Top 3 nationality flags */
              const topNationalities = Object.entries(h.demographics?.nationalities ?? {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([code, count]) => ({ country: code === "ENG" ? "GB" : code, code, count }));

              const price = h.price?.dormFrom ?? null;

              return (
                <HostelRatingCard
                  key={h.id}
                  id={h.id}
                  city={city}
                  name={h.name}
                  ratings={ratings}
                  price={price}
                  age={age}
                  tags={tags}
                  topNationalities={topNationalities}
                />
              );
            })}
        </div>
      </div>
    </>,
  );
};

export default CityHostelsPage;
