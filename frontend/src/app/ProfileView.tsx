"use client";

import React, { useEffect, useState } from "react";
import { ArrowRight, Search, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { getJson, WEIGHED_ASPECTS, type HostelRef } from "./api";
import { usePreferences, type AspectWeight, type Opinion } from "./hooks/usePreferences";
import { ASPECT_LABELS, useRecommendations } from "./personal";

const OPINION_STYLE: Record<Opinion, { color: string; Icon: typeof ThumbsUp; label: string }> = {
  liked: { color: "var(--sea)", Icon: ThumbsUp, label: "Liked it" },
  disliked: { color: "var(--sun)", Icon: ThumbsDown, label: "Didn't like it" },
};

const WEIGHTS: { w: AspectWeight | undefined; label: string }[] = [
  { w: undefined, label: "Usual" }, { w: 1, label: "Important" }, { w: 2, label: "Top" },
];

/** Per aspect: counts as usual, more (important) or most (top priority), as a segmented control. */
function AspectPriorities() {
  const { aspects, setAspect } = usePreferences();
  return (
    <ul>
      {WEIGHED_ASPECTS.map((a) => (
        <li key={a} className="flex items-center justify-between gap-4 border-t py-3 first:border-t-0 first:pt-0 last:pb-0"
          style={{ borderColor: "var(--hair)" }}>
          <span className="text-[15px]">{ASPECT_LABELS[a]}</span>
          <div role="group" aria-label={ASPECT_LABELS[a]} className="flex shrink-0 rounded-[6px] p-[3px]"
            style={{ background: "var(--plane)", border: "1px solid var(--hair)" }}>
            {WEIGHTS.map(({ w, label }) => {
              const on = aspects[a] === w;
              return (
                <button key={label} type="button" aria-pressed={on} onClick={() => setAspect(a, w)}
                  className="h-[30px] rounded-[4px] px-2.5 text-[13px] transition-colors sm:min-w-[76px] sm:px-3"
                  style={on
                    ? { background: "var(--surface)", color: "var(--ink)", boxShadow: "0 1px 2px rgba(11,13,16,.12)", fontWeight: 500 }
                    : { color: "var(--muted)" }}>
                  {label}
                </button>
              );
            })}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Name search over all hostels (GET /hostels/search), each result marked liked or disliked
 * with a thumb; ones too thinly reviewed to compare are marked. Results list inline, below the box.
 */
function StayedSearch() {
  const { setOpinion, opinionOf } = usePreferences();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ query: string; hostels: HostelRef[] } | null>(null);
  const query = q.trim();

  useEffect(() => {
    if (query.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      getJson<HostelRef[]>(`/hostels/search?q=${encodeURIComponent(query)}`)
        .then((hostels) => { if (!cancelled) setFound({ query, hostels }); })
        .catch(() => { if (!cancelled) setFound({ query, hostels: [] }); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const searching = query.length >= 2;
  const shown = searching ? (found?.hostels ?? []).filter((r) => !opinionOf(r.id)) : [];
  const done = found?.query === query;

  return (
    <div>
      <div className="relative">
        <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted)" }} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search a hostel you stayed at"
          aria-label="Search a hostel you stayed at"
          className="h-[44px] w-full rounded-[6px] border bg-[var(--surface)] pl-9 pr-3 text-[16px] outline-none transition-colors focus:border-[var(--ink)] sm:text-[15px]"
          style={{ borderColor: "var(--hair)" }} />
      </div>
      {searching && (
        <ul className={`mt-2 rounded-[6px] border px-3 text-[14px] ${done ? "" : "opacity-60"}`} aria-live="polite"
          style={{ borderColor: "var(--hair)" }}>
          {done && shown.length === 0 && <li className="py-3" style={{ color: "var(--muted)" }}>No hostel by that name</li>}
          {!found && <li className="py-3" style={{ color: "var(--muted)" }}>Searching…</li>}
          {shown.map((h) => (
            <li key={h.id} className="flex items-center gap-2 border-b py-2 last:border-b-0" style={{ borderColor: "var(--hair)" }}>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{h.name}</span>
                <span className="block truncate text-[12px]" style={{ color: "var(--muted)" }}>
                  {h.city.name}{h.comparable === false && " · no reviews stored yet"}
                </span>
              </span>
              {(["liked", "disliked"] as const).map((o) => {
                const { color, Icon, label } = OPINION_STYLE[o];
                return (
                  <button key={o} type="button" aria-label={`${label}: ${h.name}`} title={label}
                    onClick={() => { setOpinion(h, o); setQ(""); }}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] border hover:bg-[var(--wash)]"
                    style={{ borderColor: "var(--hair)", color }}>
                    <Icon size={15} aria-hidden />
                  </button>
                );
              })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Card({ step, title, aside, hint, children }: {
  step: number; title: string; aside?: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-medium"
          style={{ background: "var(--ink)", color: "var(--surface)" }}>{step}</span>
        <h2 className="flex-1 text-[17px] font-medium">{title}</h2>
        {aside}
      </div>
      {hint && <p className="mt-1.5 text-[13px] leading-snug" style={{ color: "var(--muted)" }}>{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A liked or disliked hostel, with its city; greyed when it has too few reviews to compare. */
function StayedChip({ h, o, unmatched }: { h: HostelRef; o: Opinion; unmatched: boolean }) {
  const { setOpinion } = usePreferences();
  const { color, Icon, label } = OPINION_STYLE[o];
  return (
    <li className="flex items-center gap-3 border-b py-2 last:border-b-0" style={{ borderColor: "var(--hair)" }}>
      <button type="button" title={`${label} (click to switch)`} aria-label={`${label}: ${h.name}. Switch`}
        onClick={() => setOpinion(h, o === "liked" ? "disliked" : "liked")}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
        style={{ color, background: `color-mix(in oklab, ${color} 12%, transparent)` }}>
        <Icon size={14} aria-hidden />
      </button>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px]" style={{ color: unmatched ? "var(--muted)" : "var(--ink)" }}>{h.name}</span>
        <span className="block truncate text-[12px]" style={{ color: "var(--muted)" }}>
          {h.city.name}{unmatched && " · too few reviews to compare yet"}
        </span>
      </span>
      <button type="button" aria-label={`Remove ${h.name}`} onClick={() => setOpinion(h, null)}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] hover:bg-[var(--wash)]" style={{ color: "var(--ink-2)" }}>
        <X size={15} aria-hidden />
      </button>
    </li>
  );
}

/**
 * In place of the map, on the For you tab until it's set up and from its Edit button: what For
 * you ranks by (the aspects that matter most and hostels the visitor stayed at). Kept in this
 * browser (usePreferences).
 */
export default function ProfileView({ onShowMatches }: { onShowMatches: () => void }) {
  const prefs = usePreferences();
  const { liked, disliked } = prefs;
  const stayed = [
    ...liked.map((h) => ({ h, o: "liked" as const })),
    ...disliked.map((h) => ({ h, o: "disliked" as const })),
  ];
  // Only to learn which stayed-at hostels can't be compared (`unmatched`).
  const { result, stale } = useRecommendations(prefs, null, stayed.length > 0);
  const unmatched = (result ?? stale)?.unmatched ?? [];

  return (
    <div className="profile-view">
      <main className="mx-auto grid w-full max-w-[680px] gap-4 px-4 pb-[calc(32px+env(safe-area-inset-bottom))] pt-8 sm:pt-12">
        <header className="mb-2">
          <h1 className="display text-[34px] sm:text-[42px]">Your traveller profile</h1>
          <p className="mt-2 text-[15px]" style={{ color: "var(--ink-2)" }}>Hostels you loved shape your matches.</p>
        </header>

        <Card step={1} title="Hostels you stayed at"
          aside={stayed.length > 0 && <span className="num text-[13px]" style={{ color: "var(--muted)" }}>{stayed.length} added</span>}>
          {stayed.length > 0 && (
            <ul className="mb-3">
              {stayed.map(({ h, o }) => <StayedChip key={h.id} h={h} o={o} unmatched={unmatched.includes(h.id)} />)}
            </ul>
          )}
          <StayedSearch />
        </Card>

        <Card step={2} title="What matters most"
          hint="Important aspects count as much as the overall rating; top ones twice as much.">
          <AspectPriorities />
        </Card>

        <div className="mt-2 flex flex-col-reverse items-center gap-3 sm:flex-row sm:justify-between">
          <span className="text-[12px]" style={{ color: "var(--muted)" }}>
            {prefs.hasProfile ? "Saved in this browser only" : "Add a hostel or pick an aspect to see your matches"}
          </span>
          <button type="button" onClick={onShowMatches} disabled={!prefs.hasProfile}
            className="inline-flex h-[44px] w-full items-center justify-center gap-2 rounded-[6px] px-5 text-[14px] font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30 sm:w-auto"
            style={{ background: "var(--ink)", color: "var(--surface)" }}>
            Show my matches on the map <ArrowRight size={16} aria-hidden />
          </button>
        </div>
      </main>
    </div>
  );
}
