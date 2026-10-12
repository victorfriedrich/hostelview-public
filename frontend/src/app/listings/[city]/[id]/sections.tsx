"use client";

import { ReactNode, useEffect, useState } from "react";
import type { Aspect, Hostel } from "@/app/api";

/* ── shared bits ──────────────────────────────────────────────────────────── */

/** Bars grow from zero once, after the first paint. */
function useGrown() {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  return grown;
}

/** Plain text switch: the active option is ink and underlined. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 13,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: number;
}) {
  return (
    <div className="flex gap-5" role="group" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} aria-pressed={on} onClick={() => onChange(o.value)}
            className="pb-[3px] transition-colors"
            style={{ fontSize: size, color: on ? "var(--ink)" : "var(--muted)", borderBottom: `1.5px solid ${on ? "var(--ink)" : "transparent"}` }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Card({ title, controls, children, delay = 0 }: {
  title: string;
  controls?: ReactNode;
  children: ReactNode;
  delay?: number;
}) {
  return (
    <section className="card rise p-5 sm:p-6" style={{ animationDelay: `${delay}s` }}>
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-medium">{title}</h2>
        {controls}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[13px]" style={{ color: "var(--muted)" }}>{children}</p>;
}

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

/* ── ratings ──────────────────────────────────────────────────────────────── */

/** Aspects in display order. */
const ASPECTS: [string, Aspect][] = [
  ["Cleanliness", "cleanliness"],
  ["Facilities", "facilities"],
  ["Security", "security"],
  ["Staff", "staff"],
  ["Atmosphere", "atmosphere"],
  ["Location", "location"],
  ["Value", "value"],
];

export type RatingSource = "guests" | "jev";

/** A guest score (0-10): Hostelworld's published one, else the average over the stored reviews. */
export function guestScore(hostel: Hostel, aspect: Aspect | "overall"): number | null {
  if (aspect === "overall") return hostel.hostelworld.rating ?? hostel.guests?.rating ?? null;
  return hostel.hostelworld.scores[aspect] ?? hostel.guests?.scores[aspect] ?? null;
}

export function overallScore(hostel: Hostel, source: RatingSource): number | null {
  if (source === "guests") return guestScore(hostel, "overall");
  const jev = hostel.jev;
  if (!jev) return null;
  if (jev.rating != null) return jev.rating;
  const vals = ASPECTS.map(([, k]) => jev.scores[k]).filter((v): v is number => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export function Ratings({ hostel, source, onSource }: { hostel: Hostel; source: RatingSource; onSource: (s: RatingSource) => void }) {
  const grown = useGrown();
  const color = source === "jev" ? "var(--jev)" : "var(--sea)";
  const overall = overallScore(hostel, source);

  const rows = ASPECTS.map(([label, key]) => ({
    label,
    guest: guestScore(hostel, key),
    value: source === "jev" ? hostel.jev?.scores[key] ?? null : guestScore(hostel, key),
  }));
  const hasAny = rows.some((r) => r.value != null);

  return (
    <Card
      title="Ratings"
      controls={
        <Segmented label="source of the ratings" value={source} onChange={onSource} size={14}
          options={[
            { value: "guests", label: "Guests" },
            { value: "jev", label: "LLM" },
          ]} />
      }
    >
      {hasAny ? (
        <div className="grid gap-5 sm:grid-cols-[104px_1fr] sm:gap-7">
          <div className="display num text-[48px] sm:text-[56px]">{overall != null ? overall.toFixed(1) : "—"}</div>
          <div>
            <div className="grid gap-[10px]">
              {rows.map((r, i) => (
                <div key={r.label} className="grid grid-cols-[84px_1fr_30px] items-center gap-3 text-[13px]">
                  <span style={{ color: "var(--ink-2)" }}>{r.label}</span>
                  <div className="bar">
                    <div className="fill" style={{
                      width: grown && r.value != null ? `${((r.value - 2) / 8) * 100}%` : 0,
                      background: color,
                      transitionDelay: `${0.04 * i}s`,
                    }} />
                    {source === "jev" && r.guest != null && (
                      <span aria-hidden className="absolute top-[-4px] h-[14px] w-[2px] rounded-full"
                        style={{ left: `calc(${((r.guest - 2) / 8) * 100}% - 1px)`, background: "var(--sea)", opacity: 0.7, transition: "left 1.1s var(--ease)" }}
                        title={`Guests: ${r.guest.toFixed(1)}`} />
                    )}
                  </div>
                  <span className="num text-right font-medium">{r.value != null ? r.value.toFixed(1) : "—"}</span>
                </div>
              ))}
            </div>
            {source === "jev" && (
              <div className="mt-4 text-[11px]" style={{ color: "var(--muted)" }}>Ticks mark the guest score</div>
            )}
          </div>
        </div>
      ) : (
        <Empty>
          {source === "jev"
            ? "Not rated by the LLM yet."
            : "No guest scores on Hostelworld yet."}
        </Empty>
      )}
    </Card>
  );
}

/* ── nationalities ────────────────────────────────────────────────────────── */

/** Hostelworld uses a few non-ISO codes for UK nations. */
const SUBDIVISIONS: Record<string, [string, string]> = {
  ENG: ["gb-eng", "England"],
  SCO: ["gb-sct", "Scotland"],
  WAL: ["gb-wls", "Wales"],
  NIR: ["gb-nir", "Northern Ireland"],
};

let regionNames: Intl.DisplayNames | null = null;
export function countryName(code: string, fallback?: string) {
  if (SUBDIVISIONS[code]) return SUBDIVISIONS[code][1];
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(code) ?? fallback ?? code;
  } catch {
    return fallback ?? code;
  }
}

export function Flag({ code }: { code: string }) {
  const [failed, setFailed] = useState(false);
  const slug = SUBDIVISIONS[code]?.[0] ?? code.toLowerCase();
  const box = "h-[18px] w-[26px] shrink-0 rounded-[4px]";
  if (failed || !/^[a-z]{2}(-[a-z]{3})?$/.test(slug)) {
    return <span className={`${box} grid place-items-center text-[9px] font-medium`} style={{ background: "var(--wash)", color: "var(--muted)" }}>{code}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`https://flagcdn.com/${slug}.svg`} alt="" loading="lazy" onError={() => setFailed(true)}
      className={`${box} object-cover`} style={{ boxShadow: "0 0 0 1px var(--hair)" }} />
  );
}

export function Nationalities({ hostel, delay }: { hostel: Hostel; delay?: number }) {
  const grown = useGrown();
  const short: Record<string, number> = hostel.demographics?.nationalities ?? {};
  const entries = Object.entries(short).map(([code, n]) => [code, Number(n) || 0] as const).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  const top = entries.slice(0, 7);
  const rest = entries.slice(7);
  const max = top[0]?.[1] ?? 1;

  return (
    <Card title="Where guests come from" delay={delay}>
      {top.length ? (
        <>
          <div className="grid gap-y-[10px]">
            {top.map(([code, n], i) => (
              <div key={code} className="grid grid-cols-[26px_minmax(0,1fr)_40px] items-center gap-3 text-[13px]">
                <Flag code={code} />
                <div className="min-w-0">
                  <div className="mb-[5px] truncate leading-tight">{countryName(code)}</div>
                  <div className="bar" style={{ height: 3 }}>
                    <div className="fill" style={{ width: grown ? `${(n / max) * 100}%` : 0, background: "var(--sea)", transitionDelay: `${0.04 * i}s` }} />
                  </div>
                </div>
                <span className="num text-right font-medium">{pct(n, total)}%</span>
              </div>
            ))}
          </div>
          {rest.length > 0 && (
            <div className="mt-3 text-[12px]" style={{ color: "var(--muted)" }}>
              + {rest.length} more {rest.length === 1 ? "country" : "countries"} ({pct(rest.reduce((a, [, n]) => a + n, 0), total)}%)
            </div>
          )}
        </>
      ) : (
        <Empty>No nationality data yet.</Empty>
      )}
    </Card>
  );
}

/* ── guest statistics ─────────────────────────────────────────────────────── */

const TRAVELLER = [
  { key: "FEMALE", label: "Solo female", color: "var(--sea)" },
  { key: "MALE", label: "Solo male", color: "var(--sea-soft)" },
  { key: "GROUP", label: "Group", color: "var(--axis)" },
];

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="display num text-[30px]">{value}</div>
      <div className="mt-1 text-[12px]" style={{ color: "var(--muted)" }}>{label}</div>
    </div>
  );
}

export function GuestStatistics({ hostel, delay }: { hostel: Hostel; delay?: number }) {
  const grown = useGrown();
  const demo = hostel.demographics;

  const ages = Object.entries(demo?.age ?? {})
    .map(([range, n]) => ({ range, n: Number(n) || 0 }))
    .sort((a, b) => parseInt(a.range) - parseInt(b.range));
  const ageTotal = ages.reduce((a, b) => a + b.n, 0);
  const ageMax = Math.max(1, ...ages.map((a) => a.n));

  const groups = demo?.gender ?? {};
  const travellers = TRAVELLER.map((t) => ({ ...t, n: Number(groups[t.key]) || 0 }));
  const travTotal = travellers.reduce((a, b) => a + b.n, 0);

  const experience = demo?.reviewerExperienceMedian ?? null;
  const hasStats = experience != null;

  if (!ageTotal && !travTotal) {
    return <Card title="Guest statistics" delay={delay}><Empty>No guest statistics yet.</Empty></Card>;
  }

  return (
    <Card title="Guest statistics" delay={delay}>
      <div className={`grid gap-8 md:gap-10 ${hasStats ? "md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px]" : "md:grid-cols-2"}`}>
        <div>
          <div className="eyebrow mb-3">Age</div>
          {ageTotal ? (
            <div className="grid gap-[10px]">
              {ages.map((a, i) => (
                <div key={a.range} className="grid grid-cols-[48px_1fr_40px] items-center gap-3 text-[13px]">
                  <span className="num" style={{ color: "var(--ink-2)" }}>{a.range}</span>
                  <div className="bar">
                    <div className="fill" style={{ width: grown ? `${(a.n / ageMax) * 100}%` : 0, background: "var(--sea)", transitionDelay: `${0.04 * i}s` }} />
                  </div>
                  <span className="num text-right font-medium">{pct(a.n, ageTotal)}%</span>
                </div>
              ))}
            </div>
          ) : <Empty>No age data.</Empty>}
        </div>

        <div>
          <div className="eyebrow mb-3">Travelling as</div>
          {travTotal ? (
            <>
              <div className="flex h-[8px] overflow-hidden rounded-full">
                {travellers.filter((t) => t.n > 0).map((t) => (
                  <div key={t.key} title={`${t.label}: ${pct(t.n, travTotal)}%`} className="h-full"
                    style={{ width: grown ? `${(t.n / travTotal) * 100}%` : 0, background: t.color, transition: "width 1.1s var(--ease)" }} />
                ))}
              </div>
              <div className="mt-3 grid gap-[8px] text-[13px]">
                {travellers.map((t) => (
                  <div key={t.key} className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2" style={{ color: "var(--ink-2)" }}>
                      <span className="h-[8px] w-[8px] rounded-full" style={{ background: t.color }} />{t.label}
                    </span>
                    <span className="num font-medium">{pct(t.n, travTotal)}%</span>
                  </div>
                ))}
              </div>
            </>
          ) : <Empty>No traveller data.</Empty>}
        </div>

        {hasStats && (
        <div className="grid content-start gap-5 md:border-l md:pl-8" style={{ borderColor: "var(--hair)" }}>
          {experience != null && <Stat value={String(experience)} label="reviews per guest (median)" />}
        </div>
        )}
      </div>
    </Card>
  );
}
