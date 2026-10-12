"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import type { Hostel } from "@/app/api";
import { usePreferences } from "@/app/hooks/usePreferences";

/** Liked it / didn't like it: steers the For you ranking on the map view, in every city. */
export function OpinionButtons({ hostel }: { hostel: Hostel }) {
  const { opinionOf, setOpinion } = usePreferences();
  const current = opinionOf(hostel.id);
  const buttons = [
    { o: "liked" as const, Icon: ThumbsUp, label: "Liked it", color: "var(--sea)",
      hint: "Hostels its fans rated 9.4+, and ones with a crowd and scores like it, rank higher for you" },
    { o: "disliked" as const, Icon: ThumbsDown, label: "Didn't like it", color: "var(--sun)",
      hint: "Hostels its fans rated 9.4+, and ones with a crowd and scores like it, rank a little lower for you" },
  ];
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Your stay here">
      {buttons.map(({ o, Icon, label, color, hint }) => {
        const on = current === o;
        return (
          <button key={o} type="button" onClick={() => setOpinion(hostel, on ? null : o)} aria-pressed={on} title={hint}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors"
            style={{ borderColor: on ? color : "var(--hair)", color: on ? color : "var(--ink-2)" }}>
            <Icon size={14} aria-hidden fill={on ? "currentColor" : "none"} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
