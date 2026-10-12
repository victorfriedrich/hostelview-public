"use client";
import React, { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import HostelReviewChart from "@/app/HostelReviewChart";
import { useHostel } from "@/app/hooks/useHostelData";
import { Nav } from "../../Nav";
import { GuestStatistics, Nationalities, RatingSource, Ratings, overallScore } from "./sections";
import { OpinionButtons } from "./OpinionButtons";
import { AlsoStayed } from "./AlsoStayed";

const prettyCity = (slug: string) =>
  decodeURIComponent(slug).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px]" style={{ color: "var(--muted)" }}>{label}</dt>
      <dd className="display num mt-1 text-[30px]">{value}</dd>
    </div>
  );
}

export default function ListingPage() {
  const params = useParams();
  const hostelId = String(params.id ?? "");
  const cityStr = String(params.city ?? "");

  const [source, setSource] = useState<RatingSource>("guests");
  const { hostel, loading, error } = useHostel(hostelId, cityStr);
  const cityLabel = hostel?.city.name ?? prettyCity(cityStr);

  const shell = (children: React.ReactNode) => (
    <div className="lux min-h-screen">
      <Nav city={cityStr} cityLabel={cityLabel} />
      {children}
    </div>
  );

  if (loading) {
    return shell(
      <main className="mx-auto w-full max-w-[1080px] px-4 pt-8 sm:px-6 sm:pt-10" aria-busy>
        <div className="h-[11px] w-40 animate-pulse rounded-full" style={{ background: "var(--hair)" }} />
        <div className="mt-6 h-[52px] w-[min(520px,100%)] animate-pulse rounded-[6px]" style={{ background: "var(--hair)" }} />
        <div className="card mt-8 h-[320px] animate-pulse" />
      </main>,
    );
  }

  if (error || !hostel) {
    return shell(
      <main className="mx-auto w-full max-w-[1080px] px-4 pt-16 sm:px-6">
        <div className="eyebrow mb-4">{cityLabel}</div>
        <h1 className="display text-[40px] sm:text-[56px]">{error ? "Couldn't load this hostel" : "Hostel not found"}</h1>
        <p className="caption mt-5">{error ?? `There is no hostel with id ${hostelId} in ${cityLabel}.`}</p>
        <Link href={`/listings/${cityStr}`} className="mt-8 inline-block text-[13px] underline underline-offset-4">
          All hostels in {cityLabel}
        </Link>
      </main>,
    );
  }

  const name = hostel.name || "Hostel";
  const reviews = hostel.hostelworld.reviewCount;
  const price = hostel.price?.dormFrom ?? null;
  const guestOverall = overallScore(hostel, "guests");

  return shell(
    <main className="mx-auto w-full max-w-[1080px] px-4 pb-16 sm:px-6">
      <section className="rise flex flex-wrap items-end justify-between gap-6 pb-8 pt-10 sm:pt-14">
        <div className="min-w-0">
          <div className="eyebrow mb-3">{cityLabel}</div>
          <h1 className="display text-[40px] sm:text-[52px]">{name}</h1>
          {hostel.delisted && <p className="caption mt-3">No longer listed on Hostelworld.</p>}
          <div className="mt-4"><OpinionButtons hostel={hostel} /></div>
        </div>
        <dl className="flex gap-8 sm:gap-10">
          {guestOverall != null && <Figure label="Rating" value={guestOverall.toFixed(1)} />}
          {reviews != null && <Figure label="Reviews" value={Number(reviews).toLocaleString("en-US")} />}
          {price != null && <Figure label="Dorm from" value={`€${price.toFixed(0)}`} />}
        </dl>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Ratings hostel={hostel} source={source} onSource={setSource} />
        <Nationalities hostel={hostel} delay={0.06} />
      </div>

      <div className="mt-4">
        <HostelReviewChart id={hostelId} />
      </div>

      <div className="mt-4">
        <AlsoStayed hostelId={hostel.id} hostelName={name} delay={0.11} />
      </div>

      <div className="mt-4">
        <GuestStatistics hostel={hostel} delay={0.12} />
      </div>

    </main>,
  );
}
