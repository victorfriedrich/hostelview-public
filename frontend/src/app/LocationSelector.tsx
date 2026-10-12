"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { BedDouble, MapPin, Search, Star, X } from 'lucide-react';
import { useCities } from './hooks/useCities';
import { useRouter } from 'next/navigation';
import { getJson, HostelRef } from './api';

// Rendering all ~2.5k cities at once makes the dropdown janky; show the best
// matches and let the user narrow the rest down by typing.
const MAX_RESULTS = 50;
// Cities win: hostels are only searched once no city matches, and only on a clear name hit:
// the query is at least this long and each of its words starts a word of the hostel's name
// (?names_only).
const HOSTEL_MIN_QUERY = 4;
const MAX_HOSTELS = 5;

const LocationSelector = () => {
  const router = useRouter();
  const { cities: fetchedCities, loading, error } = useCities();

  // Precompute display label + lowercase search keys once per fetch, not per keystroke/hover.
  const cities = useMemo(
    () =>
      // Only cities with a rated hostel: every result shows its best score.
      (fetchedCities || []).filter(c => c.topRating != null).map(({ slug, name, country, topRating }) => {
        const label = country ? `${name}, ${country}` : name;
        const lower = label.toLowerCase();
        return { slug, label, name, country: country || '', topRating: topRating!, lower, words: lower.split(/[\s,]+/) };
      }),
    [fetchedCities]
  );

  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Wait for the user to type before suggesting anything; an alphabetical dump on focus is noise.
  const open = showDropdown && query.trim().length > 0;
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const { filteredCities, totalMatches } = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/-/g, ' ');
    // City-name prefix matches rank above matches on a later word or the country.
    const primary: typeof cities = [];
    const secondary: typeof cities = [];
    for (const city of cities) {
      if (city.lower.startsWith(q)) primary.push(city);
      else if (city.words.some(w => w.startsWith(q))) secondary.push(city);
    }
    const all = primary.concat(secondary);
    return { filteredCities: all.slice(0, MAX_RESULTS), totalMatches: all.length };
  }, [cities, query]);

  const [hostels, setHostels] = useState<HostelRef[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (totalMatches > 0 || q.replace(/[^\p{L}\p{N}]/gu, '').length < HOSTEL_MIN_QUERY) {
      setHostels([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      getJson<HostelRef[]>(`/hostels/search?q=${encodeURIComponent(q)}&limit=${MAX_HOSTELS}&names_only=true`)
        .then(r => { if (!cancelled) setHostels(r); })
        .catch(() => { if (!cancelled) setHostels([]); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, totalMatches]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setShowDropdown(true);
    setSelectedIndex(0);
  };

  // Cities then hostels, as one list for keyboard navigation.
  const optionCount = filteredCities.length + hostels.length;

  // Keyboard navigation scrolls the active row into view; mouse hover must not.
  const scrollOnSelect = useRef(false);

  const selectCity = (city: (typeof cities)[number]) => {
    setQuery(city.label);
    setShowDropdown(false);
    router.push(`/listings/${encodeURIComponent(city.slug)}`);
  };

  const selectHostel = (hostel: HostelRef) => {
    setQuery(hostel.name);
    setShowDropdown(false);
    router.push(`/listings/${encodeURIComponent(hostel.city.slug)}/${hostel.id}`);
  };

  const selectOption = (index: number) => {
    if (index < filteredCities.length) selectCity(filteredCities[index]);
    else if (hostels[index - filteredCities.length]) selectHostel(hostels[index - filteredCities.length]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && open && optionCount > 0) {
      e.preventDefault();
      selectOption(Math.min(selectedIndex, optionCount - 1));
    } else if (e.key === 'ArrowDown' && open) {
      e.preventDefault();
      scrollOnSelect.current = true;
      setSelectedIndex(prev => (prev < optionCount - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault();
      scrollOnSelect.current = true;
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  const clearInput = () => {
    setQuery('');
    containerRef.current?.querySelector('input')?.focus();
  };

  useEffect(() => {
    if (!scrollOnSelect.current) return;
    scrollOnSelect.current = false;
    const el = dropdownRef.current?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full max-w-[360px]">
      <div
        className={`flex h-[38px] items-center gap-2 rounded-[6px] border bg-[var(--surface)] px-3 transition-colors ${
          open ? 'border-[var(--ink)]' : 'border-[var(--hair)] hover:border-[var(--axis)] focus-within:border-[var(--ink)]'
        }`}
      >
        <Search size={16} aria-hidden className="shrink-0 text-[var(--muted)]" />
        <input
          type="text"
          name="location-search"
          value={query}
          onChange={handleInputChange}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={handleKeyDown}
          className="h-full w-full min-w-0 bg-transparent text-[14px] text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
          placeholder={cities.length ? `Search ${cities.length} cities or a hostel` : 'Search cities or a hostel'}
          role="combobox"
          aria-expanded={open}
          aria-controls="city-options"
          autoComplete="off"
          autoCapitalize="off"
          data-lpignore="true"
          autoCorrect="off"
          spellCheck="false"
        />
        {query && (
          <button
            className="grid h-5 w-5 shrink-0 place-items-center rounded-[4px] bg-[var(--wash)] text-[var(--ink-2)] hover:bg-[var(--hair)]"
            onClick={clearInput}
            aria-label="Clear"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {open && (
        <div
          ref={dropdownRef}
          id="city-options"
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[344px] overflow-y-auto rounded-[6px] border border-[var(--hair)] bg-[var(--surface)] p-1.5 shadow-[0_12px_32px_rgba(11,13,16,0.08),0_2px_6px_rgba(11,13,16,0.04)]"
        >
          {loading && <div className="px-3 py-2.5 text-[14px] text-[var(--muted)]">Loading cities…</div>}
          {error && <div className="px-3 py-2.5 text-[14px] text-[var(--sun)]">Couldn&apos;t load cities. {error}</div>}
          {!loading && !error && optionCount === 0 && (
            <div className="px-3 py-2.5 text-[14px] text-[var(--muted)]">No cities or hostels match &ldquo;{query}&rdquo;</div>
          )}
          {!loading && !error && filteredCities.map((city, index) => {
            const { name, country, topRating } = city;
            const active = selectedIndex === index;
            return (
              <div
                key={`${city.label}-${index}`}
                data-index={index}
                className={`flex cursor-pointer items-center gap-3 rounded-[4px] px-3 py-2 ${active ? 'bg-[var(--wash)]' : ''}`}
                onClick={() => selectCity(city)}
                onMouseEnter={() => setSelectedIndex(index)}
                role="option"
                aria-selected={active}
              >
                <MapPin size={15} aria-hidden className={`shrink-0 ${active ? 'text-[var(--sea)]' : 'text-[var(--axis)]'}`} />
                <span className="min-w-0 flex-1 truncate text-[14px]">
                  <span className="text-[var(--ink)]">{name}</span>
                  {country && <span className="text-[var(--muted)]">, {country}</span>}
                </span>
                <span
                  className="num flex shrink-0 items-center gap-1 text-[12px] text-[var(--muted)]"
                  title="Best-rated hostel"
                >
                  <Star size={11} aria-hidden className="fill-current" />
                  {topRating.toFixed(1)}
                </span>
                {active && (
                  <kbd className="shrink-0 rounded-[3px] border border-[var(--hair)] px-1.5 font-sans text-[11px] leading-[18px] text-[var(--muted)]">
                    ↵
                  </kbd>
                )}
              </div>
            );
          })}
          {!loading && !error && totalMatches > filteredCities.length && (
            <div className="px-3 py-2 text-[12px] text-[var(--muted)]">
              {totalMatches - filteredCities.length} more &mdash; keep typing to narrow down
            </div>
          )}
          {!loading && !error && hostels.length > 0 && (
            <>
              <div className="px-3 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--muted)]">Hostels</div>
              {hostels.map((hostel, i) => {
                const index = filteredCities.length + i;
                const active = selectedIndex === index;
                return (
                  <div
                    key={hostel.id}
                    data-index={index}
                    className={`flex cursor-pointer items-center gap-3 rounded-[4px] px-3 py-2 ${active ? 'bg-[var(--wash)]' : ''}`}
                    onClick={() => selectHostel(hostel)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    role="option"
                    aria-selected={active}
                  >
                    <BedDouble size={15} aria-hidden className={`shrink-0 ${active ? 'text-[var(--sea)]' : 'text-[var(--axis)]'}`} />
                    <span className="min-w-0 flex-1 truncate text-[14px]">
                      <span className="text-[var(--ink)]">{hostel.name}</span>
                      <span className="text-[var(--muted)]">, {hostel.city.name}</span>
                    </span>
                    {active && (
                      <kbd className="shrink-0 rounded-[3px] border border-[var(--hair)] px-1.5 font-sans text-[11px] leading-[18px] text-[var(--muted)]">
                        ↵
                      </kbd>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default LocationSelector;
