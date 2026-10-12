'use client';

import { useState } from 'react';
import { getJson, type Review } from '../api';

/** The reviews of a date range picked on a hostel's review chart. */
export function useReviewSelection(id: string) {
  const [selectedReviews, setSelectedReviews] = useState<Review[]>([]);
  const [isLoadingReviews, setIsLoadingReviews] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showReviews, setShowReviews] = useState(true);

  /**
   * Loads the reviews written between two dates (YYYY-MM-DD). Only Hostelworld reviews are
   * stored, so `source` doesn't narrow the query; it's required so a cleared selection loads nothing.
   */
  const fetchReviewsForRange = async (source: string, startDate: string, endDate: string) => {
    if (!source || !startDate || !endDate) return;
    setIsLoadingReviews(true);
    setErrorMessage(null);
    try {
      setSelectedReviews(await getJson<Review[]>(`/hostels/${id}/reviews?from=${startDate}&to=${endDate}`));
    } catch (err) {
      console.error('Error fetching reviews:', err);
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingReviews(false);
    }
  };

  return {
    selectedReviews,
    isLoadingReviews,
    errorMessage,
    showReviews,
    fetchReviewsForRange,
    toggleReviews: () => setShowReviews((s) => !s),
    clearReviews: () => setSelectedReviews([]),
  };
}
