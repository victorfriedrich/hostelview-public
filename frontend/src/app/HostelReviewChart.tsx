"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Review } from './api';
import { useReviewData, type RatingType, type SeriesPoint, type Timeframe } from './hooks/useReviewData';
import { useReviewSelection } from './hooks/useReviewSelection';

const ReviewItem = ({ review }: { review: Review }) => (
  <li className="py-4" style={{ borderTop: '1px solid var(--hair)' }}>
    <div className="mb-1 flex items-baseline justify-between gap-4 text-[12px]" style={{ color: 'var(--muted)' }}>
      <span>{new Date(review.date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</span>
      {review.score != null && (
        <span className="num whitespace-nowrap font-medium" style={{ color: 'var(--ink)' }}>
          {review.score === 10 ? '10' : review.score.toFixed(1)}
        </span>
      )}
    </div>
    <p className="whitespace-pre-line text-[14px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>{review.text}</p>
  </li>
);

const ReviewSkeleton = () => (
  <div className="grid animate-pulse gap-2 py-4" style={{ borderTop: '1px solid var(--hair)' }}>
    <div className="h-3 w-1/4 rounded-full" style={{ background: 'var(--hair)' }} />
    <div className="h-3 w-full rounded-full" style={{ background: 'var(--hair)' }} />
    <div className="h-3 w-2/3 rounded-full" style={{ background: 'var(--hair)' }} />
  </div>
);

/** A plain-text dropdown. */
function TextSelect<T extends string>({ options, selected, onChange }: {
  options: { value: T; label: string }[]; selected: T; onChange: (value: T) => void;
}) {
  return (
    <select
      value={selected}
      onChange={(e) => onChange(e.target.value as T)}
      className="cursor-pointer bg-transparent pr-1 text-[14px] outline-none"
      style={{ color: 'var(--ink)', fieldSizing: 'content' } as React.CSSProperties}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

const RATING_OPTIONS: { value: RatingType; label: string }[] = [
  { value: 'overall', label: 'Overall' },
  { value: 'cleanliness', label: 'Cleanliness' },
  { value: 'cleanliness_diff', label: 'Cleanliness vs. overall' },
  { value: 'atmosphere', label: 'Atmosphere' },
  { value: 'staff', label: 'Staff' },
  { value: 'location', label: 'Location' },
  { value: 'facilities', label: 'Facilities' },
  { value: 'security', label: 'Security' },
  { value: 'value', label: 'Value' },
];
const TIMEFRAME_OPTIONS: { value: Timeframe; label: string }[] = [
  { value: '6m', label: '6 months' },
  { value: '1y', label: '1 year' },
  { value: '3y', label: '3 years' },
  { value: 'all', label: 'All time' },
];

/** One row per point in time: each source's score there (0-1), keyed by source. */
type ScoreRow = { date: number } & Record<string, number | null>;
/** A chart row: a score row, a week's review count at mid-week, or both, with its week. */
type ChartRow = ScoreRow & { count?: number; week?: number; weekStart?: number };

/** The sources' series as rows by time. */
function mergeSeries(bySource: Record<string, SeriesPoint[]>): ScoreRow[] {
  const merged = new Map<number, ScoreRow>();
  for (const [source, points] of Object.entries(bySource)) {
    for (const p of points) {
      const t = p.date.getTime();
      const row = merged.get(t) ?? { date: t };
      row[source] = p.average;
      merged.set(t, row);
    }
  }
  return [...merged.values()].sort((a, b) => a.date - b.date);
}

// Only Hostelworld reviews are stored.
const SOURCE_LABEL: Record<string, string> = { hostelworld: 'Hostelworld' };
const SOURCE_COLOR: Record<string, string> = { hostelworld: 'var(--sea)' };
const colorFor = (source: string) => SOURCE_COLOR[source] ?? 'var(--ink-2)';
const labelFor = (source: string) => SOURCE_LABEL[source] ?? source;
const fmtScore = (v: number, diff: boolean) => (diff ? `${v > 0 ? '+' : ''}${(v * 10).toFixed(1)}` : (v * 10).toFixed(1));

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const fmtDay = (t: number | Date, year = true) =>
  new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });
const isoDay = (d: Date) => d.toISOString().split('T')[0];

type TooltipEntry = { dataKey?: string | number; value?: number | null; payload: ChartRow };

function ChartTooltip({ active, payload, label, diff }: {
  active?: boolean; payload?: TooltipEntry[]; label?: number; diff: boolean;
}) {
  if (!active || !payload?.length) return null;
  const scores = payload.filter((p) => p.dataKey !== 'count' && p.value != null);
  // Every row knows the review count of the week it falls in, so volume shows wherever you hover.
  const { week, weekStart } = payload[0].payload;
  if (!scores.length && week == null) return null;
  return (
    <div className="rounded-[6px] px-3 py-2 text-[12px]" style={{ background: 'var(--surface)', border: '1px solid var(--hair)', boxShadow: '0 8px 28px rgba(0,0,0,0.08)' }}>
      <p className="mb-1" style={{ color: 'var(--muted)' }}>
        {scores.length && label != null ? fmtDay(label) : weekStart != null ? `Week of ${fmtDay(weekStart)}` : ''}
      </p>
      {scores.map((p) => (
        <p key={String(p.dataKey)} className="num flex items-center gap-2">
          <span className="h-[2px] w-[10px] rounded-full" style={{ background: colorFor(String(p.dataKey)) }} />
          <span className="font-medium">{fmtScore(p.value!, diff)}</span>
          <span style={{ color: 'var(--ink-2)' }}>{labelFor(String(p.dataKey))}</span>
        </p>
      ))}
      {week != null && weekStart != null && (
        <p className="num" style={{ color: 'var(--ink-2)' }}>
          {week} {week === 1 ? 'review' : 'reviews'} {scores.length ? `in week of ${fmtDay(weekStart, false)}` : ''}
        </p>
      )}
    </div>
  );
}

function ReviewsList({ reviews, loading, startDate, endDate, onClearSelection }: {
  reviews: Review[]; loading: boolean; startDate: Date; endDate: Date; onClearSelection: () => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-4 text-[13px]">
        <span className="num">{fmtDay(startDate)} – {fmtDay(endDate)}</span>
        <button onClick={onClearSelection} className="underline underline-offset-4" style={{ color: 'var(--muted)' }}>Clear</button>
      </div>
      {loading ? (
        <div>{[0, 1, 2].map((i) => <ReviewSkeleton key={i} />)}</div>
      ) : reviews.length > 0 ? (
        <ul className="max-h-[420px] overflow-y-auto pr-2">
          {reviews.map((review) => <ReviewItem key={review.id} review={review} />)}
        </ul>
      ) : (
        <p className="py-6 text-[13px]" style={{ color: 'var(--muted)' }}>No reviews in this period.</p>
      )}
    </div>
  );
}

/** Recharts' mouse event on the chart: the x value (a time) under the pointer. */
type ChartMouse = { activeLabel?: string | number } | null;

/**
 * A hostel's score over time with reviews per week underneath. Dragging across the chart
 * selects a period and lists its reviews beside it.
 */
export default function HostelReviewChart({ id }: { id: string }) {
  const [timeframe, setTimeframe] = useState<Timeframe>('all');
  const [ratingType, setRatingType] = useState<RatingType>('overall');
  // The period whose reviews are listed.
  const [selection, setSelection] = useState<{ start: Date; end: Date } | null>(null);
  // While dragging: the times where the drag started and where it is now.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragTo, setDragTo] = useState<number | null>(null);

  const { loading, error, reviewCount, getFilteredRollingAverage, getFilteredVolume } = useReviewData(id);
  const { selectedReviews, isLoadingReviews, fetchReviewsForRange, clearReviews } = useReviewSelection(id);

  const bySource = getFilteredRollingAverage(ratingType, timeframe);
  const sources = Object.keys(bySource);
  const scoreRows = useMemo(() => mergeSeries(bySource), [bySource]);
  const volumeData = getFilteredVolume(timeframe);

  // Scores and review volume share one time axis. Each week's bar sits mid-week, and every
  // row carries its week's count and start so the tooltip can always report volume.
  const chartData = useMemo((): ChartRow[] => {
    const weeks = volumeData.map((v) => ({ start: v.date.getTime(), end: v.end.getTime(), count: v.count }));
    const weekOf = (t: number) => {
      let lo = 0, hi = weeks.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (t < weeks[mid].start) hi = mid - 1;
        else if (t >= weeks[mid].end) lo = mid + 1;
        else return weeks[mid];
      }
      return null;
    };
    const byTime = new Map<number, ChartRow>(scoreRows.map((d) => [d.date, { ...d }]));
    for (const w of weeks) {
      const t = w.start + (w.end - w.start) / 2;
      byTime.set(t, { ...(byTime.get(t) ?? { date: t }), count: w.count });
    }
    return [...byTime.values()]
      .map((row) => {
        const w = weekOf(row.date);
        return w ? { ...row, week: w.count, weekStart: w.start } : row;
      })
      .sort((a, b) => a.date - b.date);
  }, [scoreRows, volumeData]);

  // Bars fill most of their week: size them from the plot's pixel width and the time span shown.
  const plotRef = useRef<HTMLDivElement | null>(null);
  const [plotWidth, setPlotWidth] = useState(0);
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setPlotWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);
  // Padded by half a week so the first and last weeks' bars aren't clipped at the edges.
  const xDomain: [number, number] = chartData.length
    ? [chartData[0].date - WEEK_MS / 2, chartData[chartData.length - 1].date + WEEK_MS / 2]
    : [0, WEEK_MS];
  const span = xDomain[1] - xDomain[0];
  // 46px: y-axis width (60) less the negative left margin (18), plus the right margin (4).
  const barSize = Math.max(1, Math.min(28, ((plotWidth - 46) * WEEK_MS / span) * 0.75));

  const diff = ratingType === 'cleanliness_diff';
  const yDomain = useMemo((): [number, number] => {
    const vals = scoreRows.flatMap((d) => sources.map((s) => d[s])).filter((v): v is number => v != null);
    if (!vals.length) return diff ? [-0.1, 0.1] : [0.6, 1];
    if (diff) {
      const m = Math.max(0.05, ...vals.map(Math.abs));
      return [-Math.ceil(m * 20) / 20, Math.ceil(m * 20) / 20];
    }
    return [Math.max(0.2, Math.floor(Math.min(...vals) * 20 - 1) / 20), 1];
  }, [scoreRows, sources, diff]);
  const yTicks = useMemo(() => {
    const [lo, hi] = yDomain;
    const step = diff ? 0.025 : hi - lo > 0.4 ? 0.1 : 0.05;
    const ticks: number[] = [];
    for (let t = Math.ceil(lo / step - 1e-9) * step; t <= hi + 1e-9; t += step) ticks.push(+t.toFixed(4));
    return ticks;
  }, [yDomain, diff]);
  const maxCount = Math.max(1, ...volumeData.map((v) => v.count));
  const sparse = scoreRows.length < 40;

  const finishDrag = useCallback(() => {
    if (dragFrom != null && dragTo != null) {
      const start = new Date(Math.min(dragFrom, dragTo));
      const end = new Date(Math.max(dragFrom, dragTo));
      setSelection({ start, end });
      if (sources[0]) fetchReviewsForRange(sources[0], isoDay(start), isoDay(end));
    }
    setDragFrom(null);
    setDragTo(null);
  }, [dragFrom, dragTo, sources, fetchReviewsForRange]);

  const clearSelection = () => {
    setSelection(null);
    clearReviews();
  };

  if (loading) return <div className="card h-[380px] animate-pulse" />;
  if (error) return <p className="text-[13px]" style={{ color: 'var(--muted)' }}>Couldn&apos;t load the review history.</p>;
  if (!id) return null;

  const fmtMonth = (t: number) => new Date(t).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

  return (
    <div className="card p-5 sm:p-6">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
        <h2 className="text-[15px] font-medium">Review history</h2>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <TextSelect options={RATING_OPTIONS} selected={ratingType} onChange={setRatingType} />
          <div className="flex gap-4" role="group" aria-label="timeframe">
            {TIMEFRAME_OPTIONS.map((option) => {
              const on = timeframe === option.value;
              return (
                <button
                  key={option.value}
                  aria-pressed={on}
                  className="pb-[3px] text-[14px] transition-colors"
                  style={{ color: on ? 'var(--ink)' : 'var(--muted)', borderBottom: `1.5px solid ${on ? 'var(--ink)' : 'transparent'}` }}
                  onClick={() => {
                    setTimeframe(option.value);
                    clearSelection();
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className={`grid gap-8 ${selection ? 'lg:grid-cols-2' : ''}`}>
        <div className="min-w-0">
          <div ref={plotRef} className="review-chart h-72 select-none">
            {chartData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[13px]" style={{ color: 'var(--muted)' }}>
                No reviews in this period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 8, right: 4, left: -18, bottom: 0 }}
                  onMouseDown={(e: ChartMouse) => {
                    if (e?.activeLabel == null) return;
                    setDragFrom(Number(e.activeLabel));
                    setDragTo(null);
                    clearReviews();
                  }}
                  onMouseMove={(e: ChartMouse) => {
                    if (dragFrom != null && e?.activeLabel != null) setDragTo(Number(e.activeLabel));
                  }}
                  onMouseUp={finishDrag}
                  onMouseLeave={() => { if (dragFrom != null) finishDrag(); }}
                >
                  <defs>
                    {sources.map((source) => (
                      <linearGradient key={source} id={`fill-${source}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={colorFor(source)} stopOpacity={0.14} />
                        <stop offset="100%" stopColor={colorFor(source)} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--hair)" />
                  <XAxis
                    dataKey="date"
                    type="number"
                    scale="time"
                    domain={xDomain}
                    tickFormatter={(t: number) => new Date(t).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })}
                    tick={{ fontSize: 11, fill: 'var(--muted)' }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={32}
                    height={24}
                  />
                  <YAxis
                    yAxisId="score"
                    domain={yDomain}
                    ticks={yTicks}
                    tick={{ fontSize: 11, fill: 'var(--muted)' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => fmtScore(v, diff)}
                  />
                  <YAxis yAxisId="count" hide domain={[0, maxCount * 4]} />
                  <Tooltip content={<ChartTooltip diff={diff} />} cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }} />
                  <Bar
                    yAxisId="count"
                    dataKey="count"
                    fill="var(--axis)"
                    isAnimationActive={false}
                    // Recharts caps bar width at the gap between adjacent rows, and the daily score
                    // rows make that tiny; draw each week's bar at its own width, centred on mid-week.
                    shape={(props: { x?: number; width?: number; y?: number; height?: number; fill?: string }) => {
                      const { x = 0, width = 0, y = 0, height = 0, fill } = props;
                      return height > 0
                        ? <rect x={x + width / 2 - barSize / 2} y={y} width={barSize} height={height} fill={fill} rx={barSize >= 4 ? 1.5 : 0} />
                        : <g />;
                    }}
                  />
                  {sources.map((source) => (
                    <Area
                      key={source}
                      yAxisId="score"
                      type="monotone"
                      dataKey={source}
                      stroke={colorFor(source)}
                      strokeWidth={1.75}
                      fill={`url(#fill-${source})`}
                      connectNulls
                      dot={sparse ? { r: 2.5, fill: colorFor(source), strokeWidth: 0 } : false}
                      activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
                      animationDuration={700}
                    />
                  ))}
                  {dragFrom != null && dragTo != null && (
                    <ReferenceArea yAxisId="score" x1={dragFrom} x2={dragTo} fill="var(--sea)" fillOpacity={0.08} />
                  )}
                  {selection && (
                    <ReferenceArea yAxisId="score" x1={selection.start.getTime()} x2={selection.end.getTime()} fill="var(--sea)" fillOpacity={0.08} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px]" style={{ color: 'var(--muted)' }}>
            {sources.map((source) => (
              <span key={source} className="inline-flex items-center gap-2" style={{ color: 'var(--ink-2)' }}>
                <span className="h-[2px] w-[12px] rounded-full" style={{ background: colorFor(source) }} />{labelFor(source)}
              </span>
            ))}
            <span className="inline-flex items-center gap-2" style={{ color: 'var(--ink-2)' }}>
              <span className="h-[8px] w-[6px] rounded-[1px]" style={{ background: 'var(--axis)' }} />Reviews per week
            </span>
            {chartData.length > 0 && (
              <span className="num">
                {reviewCount} reviews · {fmtMonth(chartData[0].date)} – {fmtMonth(chartData[chartData.length - 1].date)}
              </span>
            )}
            <span className="hidden sm:inline">Drag to read reviews from a period</span>
          </div>
        </div>

        {selection && (
          <div className="min-w-0">
            <ReviewsList reviews={selectedReviews} loading={isLoadingReviews} startDate={selection.start}
              endDate={selection.end} onClearSelection={clearSelection} />
          </div>
        )}
      </div>
    </div>
  );
}
