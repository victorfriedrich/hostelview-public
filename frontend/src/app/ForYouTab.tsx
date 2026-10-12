"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronUp, ThumbsDown, ThumbsUp } from "lucide-react";
import { WEIGHED_ASPECTS, type Recommendations } from "./api";
import { usePreferences, type Opinion } from "./hooks/usePreferences";
import { ASPECT_LABELS, useRecommendations, type BBox } from "./personal";

type Names = Map<number, { name: string; opinion: Opinion }>;

/**
 * Why a result is here, in at most two plain tags: a liked hostel it resembles in crowd and
 * scores, and a liked hostel whose guests rated it 9.4+ too. Dislikes lower the ranking but
 * aren't tagged.
 */
function resultTags(h: Recommendations["hostels"][number], names: Names): string[] {
  const alike = h.likedAlike && names.get(h.likedAlike.anchor)?.name;
  const fans = h.liked?.guests ? names.get(h.liked.anchor)?.name : undefined;
  return [alike && `Similar to ${alike}`, fans && `Liked by guests from ${fans}`].filter((t): t is string => !!t);
}

function Result({ h, rank, names, hot, onHover }: {
  h: Recommendations["hostels"][number];
  rank: number;
  names: Names;
  hot: boolean;
  onHover: (slug: string | null) => void;
}) {
  const tags = resultTags(h, names);

  return (
    <Link href={`/listings/${encodeURIComponent(h.city.slug)}/${h.id}`} data-city={h.city.slug}
      onMouseEnter={() => onHover(h.city.slug)} onMouseLeave={() => onHover(null)}
      className="group -mx-2 grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-3 rounded-[6px] px-2 py-3 transition-colors hover:bg-[var(--wash)]"
      style={{ borderTop: "1px solid var(--hair)", background: hot ? "var(--wash)" : undefined }}>
      <span className="num pt-[2px] text-[12px]" style={{ color: "var(--muted)" }}>{rank}</span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-medium transition-colors group-hover:text-[var(--sea)]">{h.name}</span>
        <span className="block truncate text-[12px]" style={{ color: "var(--muted)" }}>
          {h.city.name}{h.dormFrom != null && ` · dorm from €${Math.round(h.dormFrom)}`}
        </span>
        {tags.length > 0 && (
          <span className="mt-1.5 flex flex-wrap gap-1.5 text-[12px]">
            {tags.map((t) => (
              <span key={t} className="max-w-full truncate rounded-[4px] border px-1.5 leading-[18px]"
                style={{ borderColor: "color-mix(in oklab, var(--sea) 35%, transparent)", color: "var(--sea)" }}>
                {t}
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="text-right">
        <span className="display num block text-[24px]">{h.rating.toFixed(1)}</span>
        <span className="num block text-[11px]" style={{ color: "var(--muted)" }}>{h.reviewCount.toLocaleString("en-US")} reviews</span>
      </span>
    </Link>
  );
}

/** "Cleanliness first · Atmosphere matters · 👍 2 · 👎 1": the profile in one line. */
function Summary({ onEdit }: { onEdit: () => void }) {
  const { aspects, liked, disliked } = usePreferences();
  const parts = WEIGHED_ASPECTS.filter((a) => aspects[a]).map((a) => `${ASPECT_LABELS[a]} ${aspects[a] === 2 ? "first" : "matters"}`);
  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-[6px] px-3 py-2" style={{ background: "var(--wash)" }}>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        {parts.join(" · ")}
        {liked.length > 0 && (
          <span className="inline-flex items-center gap-1" title={`${liked.length} liked`}>
            <ThumbsUp size={12} aria-label="Liked" style={{ color: "var(--sea)" }} />{liked.length}
          </span>
        )}
        {disliked.length > 0 && (
          <span className="inline-flex items-center gap-1" title={`${disliked.length} didn't like`}>
            <ThumbsDown size={12} aria-label="Didn't like" style={{ color: "var(--sun)" }} />{disliked.length}
          </span>
        )}
      </span>
      <button type="button" onClick={onEdit} className="shrink-0 text-[13px] font-medium underline underline-offset-4">
        Edit
      </button>
    </div>
  );
}

/**
 * The map view's For you tab once the traveller profile is set up (before that, the tab shows
 * ProfileView): one panel over the map with the best matches among the cities on screen and
 * the profile summed up in one line. `onCities` tells the map which cities to mark.
 */
export default function ForYouTab({ bbox, onCities, onEdit, hoveredCity, onHoverCity }: {
  bbox: BBox | null;
  onCities: (slugs: string[]) => void;
  onEdit: () => void;
  /** The city of the dot hovered on the map: its results are marked and scrolled to. */
  hoveredCity: string | null;
  /** The city of the result hovered here, for the map to light up its dot. */
  onHoverCity: (slug: string | null) => void;
}) {
  const prefs = usePreferences();
  const { liked, disliked } = prefs;
  const { result, stale, error } = useRecommendations(prefs, bbox, true);
  const shown = result ?? stale;

  // On phones the sheet starts collapsed to a bar so the map stays usable.
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    if (window.matchMedia("(max-width: 640px)").matches) setExpanded(false);
  }, []);

  useEffect(() => {
    onCities([...new Set((shown?.hostels ?? []).map((h) => h.city.slug))]);
  }, [shown, onCities]);

  // Scrolls the list (not the page) to the first result in the hovered dot's city.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const body = bodyRef.current;
    const first = hoveredCity && body?.querySelector<HTMLElement>(`[data-city="${CSS.escape(hoveredCity)}"]`);
    if (!body || !first) return;
    const top = body.scrollTop + first.getBoundingClientRect().top - body.getBoundingClientRect().top - 8;
    body.scrollTo({ top, behavior: "smooth" });
  }, [hoveredCity]);

  const names = new Map([
    ...liked.map((h) => [h.id, { name: h.name, opinion: "liked" as Opinion }] as const),
    ...disliked.map((h) => [h.id, { name: h.name, opinion: "disliked" as Opinion }] as const),
  ]);
  const count = shown?.hostels.length ?? 0;

  return (
    <aside className={`foryou ${expanded ? "expanded" : ""}`} aria-label="For you">
      <button type="button" className="foryou-head" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
        <span className="text-[15px] font-medium">For you</span>
        <span className="flex items-center gap-2 text-[13px]" style={{ color: "var(--muted)" }}>
          {shown ? `${count} matches in view` : "Loading…"}
          <ChevronUp size={16} aria-hidden className="foryou-chevron" />
        </span>
      </button>

      <div className="foryou-body" ref={bodyRef}>
        <Summary onEdit={onEdit} />
        <p className="mb-2 text-[12px] leading-snug" style={{ color: "var(--muted)" }}>
          Rated for your traveller profile. Pan or zoom the map to search another area.
        </p>
        {error && !shown && <p className="text-[13px]" style={{ color: "var(--sun)" }}>Couldn&apos;t load matches. {error}</p>}
        {shown && count === 0 && (
          <p className="py-3 text-[13px]" style={{ color: "var(--muted)" }}>No well-reviewed hostels in this part of the map. Zoom out to search a wider area.</p>
        )}
        <div className={result ? "" : "opacity-60 transition-opacity"}>
          {shown?.hostels.map((h, i) => <Result key={h.id} h={h} rank={i + 1} names={names}
                hot={h.city.slug === hoveredCity} onHover={onHoverCity} />)}
        </div>
      </div>
    </aside>
  );
}
