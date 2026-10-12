/**
 * The world map on the home page: countries, a dot per city, zoom and pan, and city tooltips.
 * Plain d3 on an SVG, driven by the page (page.tsx) through the returned WorldMap.
 *
 * Explore shows every city that passes the rating and price filters. For you shows only the
 * cities of the For you matches, and lights up the dot of the city hovered in the list.
 */
import * as d3 from "d3";
import type { FeatureCollection } from "geojson";
import { getJson, type City } from "../api";
import type { BBox } from "../personal";

export type { BBox };

export interface Filters {
  /** Rate a city by its best hostel, or by the average of its top five. */
  mode: "top" | "avg";
  ratingMin: number;
  /** Euros per night; Infinity for any price. */
  priceMax: number;
}

export interface WorldMap {
  setForYou(on: boolean): void;
  /** The cities of the For you matches, the only ones shown in For you. */
  setMatchCities(slugs: string[]): void;
  /** The city whose dot is drawn larger and on top in For you, or null. */
  setHotCity(slug: string | null): void;
  setFilters(filters: Filters): void;
  destroy(): void;
}

interface Options {
  container: HTMLElement;
  /** The tooltip of the hovered or tapped city. */
  tooltip: HTMLElement;
  /** Holds the labels shown for every city in view once zoomed in on three or fewer. */
  autoTooltips: HTMLElement;
  forYou: boolean;
  filters: Filters;
  onOpenCity(slug: string): void;
  /** The visible area, after every zoom or pan. */
  onViewport(bbox: BBox): void;
  /** The city of the dot hovered in For you, or null. */
  onHoverCity(slug: string | null): void;
}

interface Marker {
  slug: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  avgRating: number | null;
  topRating: number | null;
  avgDormPrice: number | null;
  topDormPrice: number | null;
}

interface Dot extends Marker {
  x: number;
  y: number;
  baseR: number;
}

type Box = { left: number; top: number; right: number; bottom: number };

// Screen-space hit radius around a dot. Dots are drawn ~10px wide, far below a usable touch
// target, so taps are matched to the nearest dot.
const HOVER_RADIUS = 12;
const TOUCH_RADIUS = 24;
// Zoom level from which the cities in view get labels (when there are three or fewer).
const LABEL_ZOOM = 8;
const DOT_R = 5;
const HOT_DOT_R = 8;
// For you's panel covers this much of the left edge on wide screens.
const PANEL_WIDTH = 480;
const TOPBAR_HEIGHT = 60;

export function createWorldMap(opts: Options): WorldMap {
  const { container, tooltip, autoTooltips } = opts;
  const width = window.innerWidth;
  const height = window.innerHeight;

  const svg = d3.select(container).append("svg").attr("width", width).attr("height", height);
  const rootG = svg.append("g");
  const projection = d3.geoMercator().center([10, 50]).scale(1).translate([0, 0]);
  const path = d3.geoPath().projection(projection);
  rootG.append("path").datum(d3.geoGraticule().step([2.5, 2.5])()).attr("class", "graticule").attr("d", path);
  const mapG = rootG.append("g");
  const markersG = rootG.append("g");

  const state = {
    forYou: opts.forYou,
    filters: opts.filters,
    matchSlugs: new Set<string>(),
    hotSlug: null as string | null,
  };
  let markers: Marker[] = [];
  let dots: Dot[] = [];
  let qtree: d3.Quadtree<Dot> | null = null;
  let mapReady = false;
  let transform = d3.zoomIdentity;
  let activeDot: Dot | null = null;
  let pinned = false;

  tooltip.style.pointerEvents = "auto";
  tooltip.style.cursor = "pointer";
  svg.classed("foryou-map", state.forYou);

  // Opens the city of a tooltip on tap or click. Only `click` is used: listening to
  // pointerup/touchend too made a single tap navigate two or three times.
  const onTooltipActivate = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    const slug = (e.currentTarget as HTMLElement | null)?.dataset.slug;
    if (slug) opts.onOpenCity(slug);
  };
  tooltip.addEventListener("click", onTooltipActivate);

  // ── Zoom ──────────────────────────────────────────────────────────────────

  const isMobile = window.matchMedia("(pointer: coarse)").matches;
  let zoomFrame = 0;
  const zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([1, isMobile ? Infinity : 30])
    // d3 drops the click after any mouse movement at all, so a click that drifted a pixel
    // or two did nothing.
    .clickDistance(4)
    .filter((e) => !e.button && (e.type === "wheel" ? e.ctrlKey : e.touches ? e.touches.length <= 2 : true))
    .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
      // Updated at once so hit-testing always uses the current transform; the DOM work is
      // coalesced into one frame.
      transform = event.transform;
      if (zoomFrame) return;
      zoomFrame = window.requestAnimationFrame(() => {
        zoomFrame = 0;
        rootG.attr("transform", transform.toString());
        markersG.selectAll<SVGCircleElement, Dot>("circle.marker").attr("r", (d) => d.baseR / transform.k);
        if (activeDot && tooltip.style.display !== "none") showTooltip(activeDot);
        layoutAutoTooltips();
      });
    })
    .on("end", () => {
      // Saved once per gesture rather than on every frame.
      try {
        localStorage.setItem("mapTransform", JSON.stringify({ x: transform.x, y: transform.y, k: transform.k }));
      } catch {}
      updateAutoLabels();
      reportViewport();
    });
  svg.call(zoom);

  // Double-tap zooms in, but not on a dot: tapping a dot twice opens its city.
  const defaultDblZoom = svg.on("dblclick.zoom");
  svg.on("dblclick.zoom", function (this: SVGSVGElement, event: MouseEvent, d: unknown) {
    const touches = (event as unknown as TouchEvent).changedTouches;
    const [mx, my] = d3.pointer(touches ? touches[0] : event, svg.node());
    if (findDotAt(mx, my, TOUCH_RADIUS)) return;
    defaultDblZoom?.call(this, event, d);
  });

  const consumeCtrlWheel = (e: WheelEvent) => {
    if (e.ctrlKey) e.preventDefault();
  };
  svg.node()?.addEventListener("wheel", consumeCtrlWheel, { passive: false });

  /** The nearest dot within `r` screen pixels of (mx, my), or null. */
  function findDotAt(mx: number, my: number, r: number): Dot | null {
    if (!qtree) return null;
    const t = transform;
    let best: Dot | null = null;
    let bestD2 = r * r;
    qtree.visit((node, x0, y0, x1, y1) => {
      if (t.applyX(x0) > mx + r || t.applyY(y0) > my + r || t.applyX(x1) < mx - r || t.applyY(y1) < my - r) {
        return true;
      }
      if (!node.length) {
        // Leaves hold coincident points as a linked list.
        for (let n: d3.QuadtreeLeaf<Dot> | undefined = node as d3.QuadtreeLeaf<Dot>; n; n = n.next) {
          const dx = t.applyX(n.data.x) - mx;
          const dy = t.applyY(n.data.y) - my;
          if (dx * dx + dy * dy <= bestD2) {
            best = n.data;
            bestD2 = dx * dx + dy * dy;
          }
        }
      }
      return false;
    });
    return best;
  }

  // ── Pointer ───────────────────────────────────────────────────────────────

  let lastPointerType = "mouse";
  let pressOrigin: [number, number] | null = null;
  let longPressFired = false;
  let longPressTimer: ReturnType<typeof setTimeout> | undefined;

  function startLongPress(d: Dot) {
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      longPressFired = true;
      activeDot = d;
      pinned = true;
      showTooltip(d);
    }, 500);
  }
  function clearLongPress() {
    clearTimeout(longPressTimer);
    pressOrigin = null;
  }
  const radius = () => (lastPointerType === "mouse" ? HOVER_RADIUS : TOUCH_RADIUS);

  svg.on("pointerdown", (event: PointerEvent) => {
    lastPointerType = event.pointerType || "mouse";
    longPressFired = false;
    clearLongPress();
    // A second finger means pinch-zoom, not a long press.
    if (!event.isPrimary) return;
    const [mx, my] = d3.pointer(event);
    const d = findDotAt(mx, my, radius());
    if (!d) return;
    pressOrigin = [mx, my];
    startLongPress(d);
  });

  svg.on("pointermove", (event: PointerEvent) => {
    const [mx, my] = d3.pointer(event);
    // The long press is off once the finger starts panning.
    if (pressOrigin && Math.hypot(mx - pressOrigin[0], my - pressOrigin[1]) > 10) clearLongPress();
    // Hover only applies to real mice: touch taps emit compatibility mousemoves that used to
    // show a tooltip without selecting the dot, so the next tap wouldn't open it.
    if (event.pointerType !== "mouse" || pinned) return;
    const found = findDotAt(mx, my, HOVER_RADIUS);
    if (found) showTooltip(found);
    else hideTooltip();
    if (state.forYou) {
      setHotCity(found?.slug ?? null);
      opts.onHoverCity(found?.slug ?? null);
    }
  });

  svg.on("pointerup pointercancel", clearLongPress);

  svg.on("pointerleave", (event: PointerEvent) => {
    clearLongPress();
    if (event.pointerType === "mouse" && !pinned) hideTooltip();
    if (state.forYou) {
      setHotCity(null);
      opts.onHoverCity(null);
    }
  });

  svg.on("click", (event: MouseEvent) => {
    // The long press already pinned the tooltip; its release isn't a tap.
    if (longPressFired) {
      longPressFired = false;
      return;
    }
    const [mx, my] = d3.pointer(event);
    const d = findDotAt(mx, my, radius());
    if (!d) {
      // Tapping anywhere off a dot dismisses the tooltip.
      activeDot = null;
      pinned = false;
      hideTooltip();
      return;
    }
    // A mouse has already previewed the city on hover; a tap previews it first, then opens it.
    if (lastPointerType === "mouse" || (activeDot?.slug === d.slug && !pinned && tooltip.style.display !== "none")) {
      opts.onOpenCity(d.slug);
    } else {
      activeDot = d;
      pinned = false;
      showTooltip(d);
    }
  });

  // ── Tooltips ──────────────────────────────────────────────────────────────

  const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  /**
   * Places `el` next to its dot (above, below, right, left: the first that fits), inside the
   * viewport and clear of the `avoid` boxes. The placed box, or null if every place collides.
   */
  function positionTooltip(el: HTMLElement, sx: number, sy: number, avoid: Box[] = []): Box | null {
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const margin = 8;
    const clampX = (x: number) => Math.min(Math.max(x, margin), window.innerWidth - margin - w);
    const clampY = (y: number) => Math.min(Math.max(y, margin), window.innerHeight - margin - h);
    const places: [number, number][] = [
      [clampX(sx - w / 2), sy - h - margin],
      [clampX(sx - w / 2), sy + margin],
      [sx + margin, clampY(sy - h / 2)],
      [sx - w - margin, clampY(sy - h / 2)],
    ];
    const fits = ([left, top]: [number, number]) =>
      left >= margin && top >= margin && left + w <= window.innerWidth - margin && top + h <= window.innerHeight - margin;
    const toBox = ([left, top]: [number, number]): Box => ({ left, top, right: left + w, bottom: top + h });
    const pick = places.find((p) => fits(p) && !avoid.some((b) => overlaps(toBox(p), b)))
      ?? (avoid.length ? null : places.find(fits) ?? [clampX(sx - w / 2), clampY(sy - h - margin)]);
    if (!pick) return null;
    el.style.left = `${pick[0]}px`;
    el.style.top = `${pick[1]}px`;
    return toBox(pick);
  }

  function tooltipHtml(d: Dot) {
    const avg = state.filters.mode === "avg";
    const rating = avg ? d.avgRating : d.topRating;
    const price = avg ? d.avgDormPrice : d.topDormPrice;
    const priceText = price == null ? "N/A" : `€${formatNum(price, 0)}`;
    return `
      <div class="tt-row"><div class="tt-country">${escapeHtml(d.country)}</div><div class="tt-right">${formatNum(rating, 2)} ★</div></div>
      <div class="tt-row"><div class="tt-city">${escapeHtml(d.city)}</div><div class="tt-price">${priceText}</div></div>
    `;
  }

  function showTooltip(d: Dot) {
    autoTooltips.innerHTML = "";
    autoTooltips.style.pointerEvents = "none";
    tooltip.innerHTML = tooltipHtml(d);
    tooltip.dataset.slug = d.slug;
    // Shown at the origin first, so its natural size can be measured.
    tooltip.style.display = "block";
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";
    tooltip.style.transform = "none";
    positionTooltip(tooltip, transform.applyX(d.x), transform.applyY(d.y));
  }

  function hideTooltip() {
    tooltip.style.display = "none";
    if (!pinned) updateAutoLabels();
  }

  // Each auto label's dot, for laying them out.
  const labelDots = new WeakMap<HTMLElement, Dot>();

  /** Labels for every city in view, once zoomed in far enough that three or fewer are. */
  function updateAutoLabels() {
    autoTooltips.innerHTML = "";
    autoTooltips.style.pointerEvents = "none";
    if (pinned || transform.k < LABEL_ZOOM) return;
    const visible = dots.filter((d) => {
      const sx = transform.applyX(d.x);
      const sy = transform.applyY(d.y);
      return sx >= 0 && sy >= 0 && sx <= width && sy <= height;
    });
    if (visible.length === 0 || visible.length > 3) return;
    autoTooltips.style.pointerEvents = "auto";
    for (const d of visible) {
      const div = document.createElement("div");
      div.className = "tooltip";
      div.dataset.slug = d.slug;
      div.style.pointerEvents = "auto";
      div.style.cursor = "pointer";
      div.setAttribute("role", "button");
      div.setAttribute("tabindex", "0");
      div.addEventListener("click", onTooltipActivate);
      div.innerHTML = tooltipHtml(d);
      labelDots.set(div, d);
      autoTooltips.appendChild(div);
    }
    layoutAutoTooltips();
  }

  /** Lays out the auto labels clear of each other and of other dots; one that can't fit is hidden. */
  function layoutAutoTooltips() {
    const els = Array.from(autoTooltips.children) as HTMLElement[];
    const r = 8;
    const dotBoxes: Box[] = els.map((el) => {
      const d = labelDots.get(el)!;
      const x = transform.applyX(d.x);
      const y = transform.applyY(d.y);
      return { left: x - r, top: y - r, right: x + r, bottom: y + r };
    });
    const placed: Box[] = [];
    els.forEach((el, i) => {
      const d = labelDots.get(el)!;
      const avoid = dotBoxes.filter((_, j) => j !== i).concat(placed);
      const box = positionTooltip(el, transform.applyX(d.x), transform.applyY(d.y), avoid);
      el.style.visibility = box ? "visible" : "hidden";
      if (box) placed.push(box);
    });
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  function drawCountries(data: FeatureCollection) {
    mapG.selectAll("*").remove();
    const [[x0, y0], [x1, y1]] = path.bounds(data);
    const scale = 0.95 / Math.max((x1 - x0) / width, (y1 - y0) / height);
    projection.scale(scale).translate([width / 2 - scale * (x0 + x1) / 2, height / 2 - scale * (y0 + y1) / 2]);
    mapReady = true;
    rootG.select<SVGPathElement>(".graticule").attr("d", (d) => path(d as d3.GeoPermissibleObjects));
    mapG.selectAll("path").data(data.features).enter().append("path").attr("class", "feature").attr("d", path);

    let start = d3.zoomIdentity.translate(width / 2, height / 2).scale(1.3).translate(-width / 2, -height / 2);
    try {
      const saved = JSON.parse(localStorage.getItem("mapTransform") ?? "null");
      if (saved) start = d3.zoomIdentity.translate(saved.x, saved.y).scale(saved.k);
    } catch {}
    svg.call(zoom.transform, start);
  }

  /** The visible area, less the strip For you's panel covers on wide screens. */
  function reportViewport() {
    if (!mapReady) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const left = state.forYou && w > 640 ? PANEL_WIDTH : 0;
    const nw = projection.invert?.(transform.invert([left, TOPBAR_HEIGHT]));
    const se = projection.invert?.(transform.invert([w, h]));
    if (!nw || !se) return;
    const lat = (v: number) => Math.max(-85, Math.min(85, v));
    opts.onViewport([Math.max(-180, nw[0]), lat(se[1]), Math.min(180, se[0]), lat(nw[1])]);
  }

  function shownMarkers() {
    if (state.forYou) return markers.filter((d) => state.matchSlugs.has(d.slug));
    const { mode, ratingMin, priceMax } = state.filters;
    return markers.filter((d) => {
      const rating = mode === "avg" ? d.avgRating : d.topRating;
      const price = mode === "avg" ? d.avgDormPrice : d.topDormPrice;
      if (rating == null || rating < ratingMin) return false;
      return !isFinite(priceMax) || (price != null && price <= priceMax);
    });
  }

  function drawMarkers() {
    if (!mapReady) return;
    dots = shownMarkers().map((d) => {
      const [x, y] = projection([d.lon, d.lat]) ?? [0, 0];
      return { ...d, x, y, baseR: DOT_R };
    });
    const join = markersG.selectAll<SVGCircleElement, Dot>("circle.marker").data(dots, (d) => d.slug);
    join.exit().remove();
    join.enter().append("circle").attr("class", "marker");
    markersG.selectAll<SVGCircleElement, Dot>("circle.marker").attr("cx", (d) => d.x).attr("cy", (d) => d.y);
    applyHotCity();
    qtree = d3.quadtree<Dot>().x((d) => d.x).y((d) => d.y).addAll(dots);
    updateAutoLabels();
  }

  function setHotCity(slug: string | null) {
    if (slug === state.hotSlug) return;
    state.hotSlug = slug;
    applyHotCity();
  }

  /** In For you, the hot city's dot is larger, dark and on top. */
  function applyHotCity() {
    const isHot = (d: Dot) => state.forYou && d.slug === state.hotSlug;
    markersG.selectAll<SVGCircleElement, Dot>("circle.marker")
      .each((d) => { d.baseR = isHot(d) ? HOT_DOT_R : DOT_R; })
      .classed("hot", isHot)
      .attr("r", (d) => d.baseR / transform.k)
      .filter(isHot)
      .raise();
  }

  const onResize = () => svg.attr("width", window.innerWidth).attr("height", window.innerHeight);
  window.addEventListener("resize", onResize);

  let destroyed = false;
  Promise.all([
    fetch("/map.geojson").then((r) => r.json() as Promise<FeatureCollection>).catch(() => null),
    getJson<City[]>("/cities").catch(() => null),
  ]).then(([countries, cities]) => {
    if (destroyed) return;
    if (countries) drawCountries(countries);
    if (cities) {
      markers = cities.flatMap((c) => c.lat == null || c.lon == null ? [] : [{
        slug: c.slug, city: c.name, country: c.country, lat: c.lat, lon: c.lon,
        avgRating: c.avgRating, topRating: c.topRating, avgDormPrice: c.avgDormPrice, topDormPrice: c.topDormPrice,
      }]);
    }
    drawMarkers();
    reportViewport();
  });

  return {
    setForYou(on) {
      state.forYou = on;
      svg.classed("foryou-map", on);
      if (on) state.matchSlugs = new Set();
      state.hotSlug = null;
      opts.onHoverCity(null);
      activeDot = null;
      pinned = false;
      hideTooltip();
      drawMarkers();
      reportViewport();
    },
    setMatchCities(slugs) {
      state.matchSlugs = new Set(slugs);
      if (state.forYou) drawMarkers();
    },
    setHotCity,
    setFilters(filters) {
      state.filters = filters;
      drawMarkers();
      if (activeDot && tooltip.style.display !== "none") showTooltip(activeDot);
    },
    destroy() {
      destroyed = true;
      window.removeEventListener("resize", onResize);
      tooltip.removeEventListener("click", onTooltipActivate);
      clearLongPress();
      if (zoomFrame) window.cancelAnimationFrame(zoomFrame);
      svg.on(".zoom", null);
      svg.on("pointerdown pointermove pointerup pointercancel pointerleave click", null);
      svg.node()?.removeEventListener("wheel", consumeCtrlWheel);
      svg.remove();
      autoTooltips.innerHTML = "";
      tooltip.style.display = "none";
    },
  };
}

function formatNum(value: number | null, maxDecimals: number) {
  return value == null || isNaN(value) ? "" : value.toLocaleString(undefined, { maximumFractionDigits: maxDecimals });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
