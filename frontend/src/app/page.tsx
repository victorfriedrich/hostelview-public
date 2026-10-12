'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import LocationSelector from './LocationSelector';
import ForYouTab from './ForYouTab';
import ProfileView from './ProfileView';
import { usePreferences } from './hooks/usePreferences';
import { createWorldMap, type BBox, type Filters, type WorldMap } from './map/worldMap';
import './map.css';

const RATING_STEPS = [8, 8.5, 9, 9.5];
const PRICE_STEPS = [10, 15, 30, 50];
const DEFAULT_FILTERS: Filters = { mode: 'top', ratingMin: 9, priceMax: Infinity };
const MODE_LABELS: Record<Filters['mode'], string> = { top: 'Best hostel', avg: 'Top 5 average' };

/** Rating mode and minimum from the last visit (the price filter isn't kept). */
function savedFilters(): Filters {
  try {
    const saved = JSON.parse(localStorage.getItem('reviewPrefs') || '{}');
    return {
      ...DEFAULT_FILTERS,
      ...(saved.ratingMode === 'avg' || saved.ratingMode === 'top' ? { mode: saved.ratingMode } : {}),
      ...(typeof saved.ratingMin === 'number' ? { ratingMin: saved.ratingMin } : {}),
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

/** A header dropdown: one open at a time, closed by a click outside. */
function Dropdown({ id, open, onOpen, summary, children }: {
  id: string; open: boolean; onOpen: (id: string | null) => void; summary: string; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onOpen(null);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open, onOpen]);
  return (
    <details className="dropdown" ref={ref} open={open}>
      <summary className="chip" onClick={(e) => { e.preventDefault(); onOpen(open ? null : id); }}>
        <span>{summary}</span><ChevronDown size={15} aria-hidden />
      </summary>
      <div className="menu">{children}</div>
    </details>
  );
}

function ModeButtons({ filters, onChange }: { filters: Filters; onChange: (f: Partial<Filters>) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Rate cities by">
      {(['top', 'avg'] as const).map((mode) => (
        <button key={mode} type="button" className={filters.mode === mode ? 'active' : ''} aria-pressed={filters.mode === mode}
          onClick={() => onChange({ mode })}>{MODE_LABELS[mode]}</button>
      ))}
    </div>
  );
}

/**
 * The home page: the world map with Explore (cities by rating and price) and For you
 * (hostels ranked for the visitor, ForYouTab, with the map showing only their cities). Until
 * the traveller profile is set up, and while editing it ('profile': from For you's Edit, or
 * the tab itself until set up), For you shows ProfileView in place of the map, until its
 * Show my matches.
 */
export default function MapPage() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const autoTooltipsRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDialogElement>(null);
  const map = useRef<WorldMap | null>(null);

  const [tab, setTab] = useState<'explore' | 'foryou' | 'profile'>('explore');
  const { hasProfile } = usePreferences();
  const showProfile = tab === 'profile' || (tab === 'foryou' && !hasProfile);
  const forYou = tab === 'foryou' && hasProfile;
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [bbox, setBbox] = useState<BBox | null>(null);
  // For you: hovering a result lights up its city's dot; hovering a dot scrolls the list to it.
  const [hoveredDot, setHoveredDot] = useState<string | null>(null);
  // Read by the map once, when it's created.
  const initial = useRef({ forYou, filters });
  initial.current = { forYou, filters };

  useEffect(() => {
    try {
      const saved = localStorage.getItem('mapTab');
      if (saved === 'foryou' || saved === 'profile') setTab('foryou');
    } catch {}
    setFilters(savedFilters());
    document.documentElement.classList.add('map-page');
    return () => document.documentElement.classList.remove('map-page');
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('mapTab', tab);
    } catch {}
  }, [tab]);

  useEffect(() => {
    const container = containerRef.current, tooltip = tooltipRef.current, autoTooltips = autoTooltipsRef.current;
    if (!container || !tooltip || !autoTooltips) return;
    const created = createWorldMap({
      container, tooltip, autoTooltips, ...initial.current,
      onOpenCity: (slug) => router.push(`/listings/${encodeURIComponent(slug)}`),
      onViewport: setBbox,
      onHoverCity: setHoveredDot,
    });
    map.current = created;
    return () => {
      created.destroy();
      map.current = null;
    };
  }, [router]);

  useEffect(() => map.current?.setForYou(forYou), [forYou]);
  useEffect(() => {
    map.current?.setFilters(filters);
    try {
      localStorage.setItem('reviewPrefs', JSON.stringify({ ratingMode: filters.mode, ratingMin: filters.ratingMin }));
    } catch {}
  }, [filters]);

  const changeFilters = (change: Partial<Filters>) => setFilters((f) => ({ ...f, ...change }));
  const onCities = useCallback((slugs: string[]) => map.current?.setMatchCities(slugs), []);
  const onHoverResult = useCallback((slug: string | null) => map.current?.setHotCity(slug), []);
  const activeFilters = Number(filters.ratingMin !== DEFAULT_FILTERS.ratingMin) + Number(isFinite(filters.priceMax));
  const priceSummary = isFinite(filters.priceMax) ? `Up to €${filters.priceMax}` : 'Any price';

  return (
    <div className={`lux ${forYou ? 'foryou-mode' : ''} ${showProfile ? 'profile-mode' : ''}`}>
      <header className="topbar">
        <div className="left">
          <span className="wordmark">Hostelview</span>
          <div className="segmented tabs" role="tablist" aria-label="Map view">
            <button type="button" role="tab" aria-selected={tab === 'explore'} className={tab === 'explore' ? 'active' : ''}
              onClick={() => setTab('explore')}>Explore</button>
            <button type="button" role="tab" aria-selected={tab !== 'explore'} className={tab !== 'explore' ? 'active' : ''}
              onClick={() => setTab(hasProfile ? 'foryou' : 'profile')}>For you</button>
          </div>
          <div className="location min-w-0 flex-1"><LocationSelector /></div>
        </div>
        <div className="right">
          <Dropdown id="rating" open={openDropdown === 'rating'} onOpen={setOpenDropdown}
            summary={`${filters.mode === 'avg' ? 'Top 5 avg' : 'Best hostel'} ≥ ${filters.ratingMin}`}>
            <h4>Rate cities by</h4>
            <ModeButtons filters={filters} onChange={changeFilters} />
            <h4>Minimum rating</h4>
            <div className="pill-group">
              {RATING_STEPS.map((v) => (
                <button key={v} type="button" className={`pill ${filters.ratingMin === v ? 'active' : ''}`}
                  onClick={() => changeFilters({ ratingMin: v })}>{v}+</button>
              ))}
            </div>
          </Dropdown>
          <Dropdown id="price" open={openDropdown === 'price'} onOpen={setOpenDropdown} summary={priceSummary}>
            <h4>Max price per night</h4>
            <div className="pill-group">
              {[Infinity, ...PRICE_STEPS].map((v) => (
                <button key={v} type="button" className={`pill ${filters.priceMax === v ? 'active' : ''}`}
                  onClick={() => changeFilters({ priceMax: v })}>{isFinite(v) ? `€${v}` : 'Any'}</button>
              ))}
            </div>
          </Dropdown>
        </div>
        <button type="button" className="chip filters-btn" aria-haspopup="dialog" onClick={() => sheetRef.current?.showModal()}>
          <SlidersHorizontal size={15} aria-hidden /><span className="filters-label">Filters</span>
          <span className="badge" hidden={activeFilters === 0}>{activeFilters}</span>
        </button>
      </header>

      {/* The filters on phones, as a bottom sheet. */}
      <dialog ref={sheetRef} className="sheet">
        <div className="grabber" aria-hidden />
        <form method="dialog">
          <header>
            <h2>Filters</h2>
            <button type="button" className="ghost-btn" onClick={() => changeFilters({ priceMax: Infinity })}>Reset price</button>
          </header>
          <div className="section">
            <label>Rate cities by</label>
            <ModeButtons filters={filters} onChange={changeFilters} />
          </div>
          <div className="section">
            <label>Minimum rating</label>
            <div className="chiprow">
              {RATING_STEPS.map((v) => (
                <button key={v} type="button" className={filters.ratingMin === v ? 'selected' : ''}
                  onClick={() => changeFilters({ ratingMin: v })}>{v}+</button>
              ))}
            </div>
          </div>
          <div className="section">
            <label htmlFor="price">Max price per night</label>
            <div className="price-group">
              <div className="price-field">
                <span>€</span>
                <input type="number" id="price" min="0" inputMode="numeric" placeholder="Any" className="price-input"
                  value={isFinite(filters.priceMax) ? filters.priceMax : ''}
                  onChange={(e) => changeFilters({ priceMax: e.target.value === '' ? Infinity : Number(e.target.value) })} />
              </div>
            </div>
          </div>
          <button value="close" className="done-btn">Show results</button>
        </form>
      </dialog>

      {forYou && <ForYouTab bbox={bbox} onCities={onCities} onEdit={() => setTab('profile')}
        hoveredCity={hoveredDot} onHoverCity={onHoverResult} />}
      {showProfile && <ProfileView onShowMatches={() => setTab('foryou')} />}
      <div id="tooltip" ref={tooltipRef} className="tooltip" style={{ display: 'none' }} />
      <div ref={autoTooltipsRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      <div ref={containerRef} className="map-canvas" />
    </div>
  );
}
