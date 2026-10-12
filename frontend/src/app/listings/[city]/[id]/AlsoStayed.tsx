"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getJson, type AlsoStayed as Data } from "@/app/api";
import { Card } from "./sections";

/**
 * "Guests of X also stayed at": the hostels closest to this one in the hostel graph, where hostels
 * are linked when guests rated both 9.4+ (GET /hostels/{id}/also-stayed).
 */
export function AlsoStayed({ hostelId, hostelName, delay }: { hostelId: number; hostelName: string; delay?: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getJson<Data>(`/hostels/${hostelId}/also-stayed`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [hostelId]);

  if (failed) return null;

  return (
    <Card title={`Guests of ${hostelName} also stayed at`} delay={delay}>
      {!data ? (
        <div className="h-[120px] animate-pulse rounded-[6px]" style={{ background: "var(--wash)" }} />
      ) : data.hostels.length === 0 ? (
        <p className="text-[13px]" style={{ color: "var(--muted)" }}>
          Not enough of its guests have reviewed other hostels yet.
        </p>
      ) : (
        <>
          <p className="mb-2 max-w-[46rem] text-[13px] leading-snug" style={{ color: "var(--ink-2)" }}>
            Hostels are linked when guests rated both 9.4 or higher. These are the closest to this one.
          </p>
          <div className="grid gap-x-8 md:grid-cols-2">
            {data.hostels.map((h) => (
              <Link key={h.id} href={`/listings/${encodeURIComponent(h.city.slug)}/${h.id}`}
                className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3"
                style={{ borderTop: "1px solid var(--hair)" }}>
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium transition-colors group-hover:text-[var(--sea)]">{h.name}</span>
                  <span className="block truncate text-[12px]" style={{ color: "var(--muted)" }}>
                    {h.city.name}{h.guestRating != null && ` · ${h.guestRating.toFixed(1)} from ${h.reviewCount.toLocaleString("en-US")} reviews`}
                  </span>
                </span>
                {h.guests ? (
                  <span className="text-right">
                    <span className="num block text-[15px] font-medium">{h.guests} guests</span>
                    <span className="block text-[11px]" style={{ color: "var(--muted)" }}>rated both 9.4+</span>
                  </span>
                ) : h.via ? (
                  <span className="w-[130px] text-right text-[12px] leading-snug" style={{ color: "var(--muted)" }}
                    title={`Its guests and this hostel's both rated ${h.via.name} 9.4+`}>
                    via <span className="line-clamp-2" style={{ color: "var(--ink-2)" }}>{h.via.name}</span>
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
