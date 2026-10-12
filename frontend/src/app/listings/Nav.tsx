import Link from "next/link";

export function Nav({ city, cityLabel }: { city: string; cityLabel: string }) {
  return (
    <header className="sticky top-0 z-40"
      style={{ background: "color-mix(in oklab, var(--plane) 85%, transparent)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", borderBottom: "1px solid var(--hair)" }}>
      <div className="mx-auto flex h-[52px] max-w-[1080px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3 text-[13px]">
          <Link href="/" className="whitespace-nowrap font-medium tracking-tight">Hostelview</Link>
          <span style={{ color: "var(--axis)" }}>/</span>
          <Link href={`/listings/${city}`} className="truncate" style={{ color: "var(--muted)" }}>{cityLabel}</Link>
        </div>
      </div>
    </header>
  );
}
