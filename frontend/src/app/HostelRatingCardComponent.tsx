import React from "react";
import Link from "next/link";
import { Flag } from "@/app/listings/[city]/[id]/sections";
import type { Tag } from "@/app/personal";

type Props = {
  id: string | number;
  city: string;
  name: string;
  ratings?: { hostelworld?: string | number; reviewCount?: string | number };
  price?: string | number | null;
  /** Largest age bucket, e.g. "18–24". */
  age?: string | null;
  tags?: Tag[];
  topNationalities?: { country: string; code: string; count: number }[];
};

const TAG_STYLES: Record<Tag["kind"], React.CSSProperties> = {
  crowd: { background: "var(--wash)", borderColor: "transparent", color: "var(--ink-2)" },
  quality: { borderColor: "var(--hair)", color: "var(--ink-2)" },
};

const HostelRatingCard = ({
  id, city, name, ratings = {}, price = null, age = null, tags = [], topNationalities = [],
}: Props) => {

  const priceNum = price != null && price !== "" ? Number(price) : null;

  return (
    <Link href={`/listings/${city}/${id}`}
      className="group grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 py-4 transition-colors sm:grid-cols-[72px_minmax(0,1fr)_auto] sm:gap-6 sm:px-3"
      style={{ borderTop: "1px solid var(--hair)" }}>
      <div>
        <div className="display num text-[30px] sm:text-[34px]">
          {ratings.hostelworld || "—"}
        </div>
        <div className="num mt-[2px] text-[11px]" style={{ color: "var(--muted)" }}>
          {ratings.reviewCount != null ? `${Number(ratings.reviewCount).toLocaleString("en-US")} reviews` : ""}
        </div>
      </div>

      <div className="min-w-0">
        <div className="truncate text-[16px] font-medium transition-colors group-hover:text-[var(--sea)]">{name}</div>
        {(age || tags.length > 0) && (
          // At most two rows of tags, so rows keep an even height on narrow screens.
          <div className="mt-1.5 flex max-h-[46px] min-w-0 flex-wrap items-center gap-1.5 overflow-hidden text-[12px]">
            {age && <span className="num mr-1 shrink-0" style={{ color: "var(--muted)" }}>Age {age}</span>}
            {tags.map((t) => (
              <span key={t.label} className="shrink-0 rounded-[4px] border px-1.5 leading-[18px]"
                title={t.title} style={TAG_STYLES[t.kind]}>
                {t.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col items-end gap-2">
        {priceNum != null && Number.isFinite(priceNum) && (
          <div className="display num text-[22px]">€{Math.round(priceNum)}</div>
        )}
        {topNationalities.length > 0 && (
          <div className="hidden gap-1 sm:flex">
            {topNationalities.map((nat) => <Flag key={nat.code} code={nat.code} />)}
          </div>
        )}
      </div>
    </Link>
  );
};

export default HostelRatingCard;
