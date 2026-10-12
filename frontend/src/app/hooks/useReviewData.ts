'use client';

import { useEffect, useState } from 'react';
import { ApiError, getJson, type History } from '../api';

/** The chart's only series: Hostelworld guest scores. */
const SOURCE = 'hostelworld';
const DAY_MS = 24 * 60 * 60 * 1000;

export type Timeframe = '6m' | '1y' | '3y' | 'all';
/** 'overall', an aspect, or how far cleanliness sits above or below the overall score. */
export type RatingType = keyof History['points'][number]['scores'] | 'cleanliness_diff';
/** A score on 0-1 (a 0-10 score / 10) at a date, one series per source. */
export type SeriesPoint = { date: Date; average: number | null };
export type VolumeBlock = { date: Date; end: Date; count: number };

type Block = { start: Date; end: Date; count: number };
type Loaded = { points: History['points']; volume: Block[] };

/** The start of `timeframe` before `end`, or null for all time. */
function timeframeStart(timeframe: Timeframe, end: Date): Date | null {
  const start = new Date(end);
  if (timeframe === '6m') start.setMonth(end.getMonth() - 6);
  else if (timeframe === '1y') start.setFullYear(end.getFullYear() - 1);
  else if (timeframe === '3y') start.setFullYear(end.getFullYear() - 3);
  else return null;
  return start;
}

/** A hostel's review history (GET /hostels/{id}/history): rolling score averages and review volume. */
export function useReviewData(id: string | null | undefined) {
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewCount, setReviewCount] = useState(0);
  const [dateRange, setDateRange] = useState<{ start: Date | null; end: Date | null }>({ start: null, end: null });

  useEffect(() => {
    if (!id) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        let result: History;
        try {
          result = await getJson<History>(`/hostels/${id}/history`);
        } catch (err) {
          // 404: no stored reviews yet, which is an empty history rather than an error.
          if (!(err instanceof ApiError && err.status === 404)) throw err;
          result = { windowDates: 14, points: [], volume: [], volumeBlockDays: 7 };
        }
        if (cancelled) return;
        const blockMs = (result.volumeBlockDays || 7) * DAY_MS;
        const volume = result.volume.map((v) => {
          const start = new Date(v.start);
          return { start, end: new Date(start.getTime() + blockMs), count: v.reviews };
        });
        setData({ points: result.points, volume });
        const dates = result.points.map((p) => new Date(p.date));
        setDateRange(dates.length ? { start: dates[0], end: dates[dates.length - 1] } : { start: null, end: null });
        setReviewCount(volume.reduce((sum, block) => sum + block.count, 0));
      } catch (err) {
        if (cancelled) return;
        console.error('Error fetching review data:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  /** The rolling-average series for one score within the timeframe, by source. */
  const getFilteredRollingAverage = (ratingType: RatingType, timeframe: Timeframe): Record<string, SeriesPoint[]> => {
    if (!data?.points.length) return {};
    const end = dateRange.end ?? new Date(data.points[data.points.length - 1].date);
    const start = timeframeStart(timeframe, end);
    const points = start ? data.points.filter((p) => new Date(p.date) >= start) : data.points;
    const value = (p: History['points'][number]) => {
      if (ratingType === 'cleanliness_diff') {
        const { cleanliness, overall } = p.scores;
        return cleanliness != null && overall != null ? Number(((cleanliness - overall) / 10).toFixed(3)) : null;
      }
      const v = p.scores[ratingType];
      return v != null ? Number((v / 10).toFixed(3)) : null;
    };
    return { [SOURCE]: points.map((p) => ({ date: new Date(p.date), average: value(p) })) };
  };

  /** Reviews per week within the timeframe. */
  const getFilteredVolume = (timeframe: Timeframe): VolumeBlock[] => {
    if (!data?.volume.length) return [];
    const end = dateRange.end ?? data.volume[data.volume.length - 1].end;
    const start = timeframeStart(timeframe, end);
    const blocks = start ? data.volume.filter((b) => b.end >= start) : data.volume;
    return blocks.map((b) => ({ date: b.start, end: b.end, count: b.count }));
  };

  return { data, loading, error, reviewCount, dateRange, getFilteredRollingAverage, getFilteredVolume };
}
