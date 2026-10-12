'use client';

import { useState, useEffect } from 'react';
import { useHostelDataContext } from '../HostelDataContext';
import { ApiError, Hostel, getJson } from '../api';

/**
 * A city's hostels (GET /cities/{slug}/hostels), cached per city for the session.
 * `notFound` is set when the backend has no such city.
 */
export function useHostelData(city: string) {
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const { getHostelsForCity, setHostelsForCity } = useHostelDataContext();

  useEffect(() => {
    setNotFound(false);
    if (!city) {
      setHostels([]);
      setLoading(false);
      setError(null);
      return;
    }

    const cached = getHostelsForCity(city);
    if (cached !== undefined) {
      setHostels(cached);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    getJson<Hostel[]>(`/cities/${encodeURIComponent(city)}/hostels`)
      .then((result) => {
        if (cancelled) return;
        setHostels(result);
        setHostelsForCity(city, result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const missing = err instanceof ApiError && err.status === 404;
        if (!missing) console.error('Error fetching hostel data:', err);
        setNotFound(missing);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [city, getHostelsForCity, setHostelsForCity]);

  return { hostels, loading, error, notFound };
}

/** One hostel (GET /hostels/{id}), taken from the city cache when it's there. */
export function useHostel(id: string, city: string) {
  const { getHostelsForCity } = useHostelDataContext();
  const [hostel, setHostel] = useState<Hostel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setNotFound(false);
    setError(null);
    const cached = getHostelsForCity(city)?.find((h) => String(h.id) === id);
    if (cached) {
      setHostel(cached);
      setLoading(false);
      return;
    }
    if (!/^\d+$/.test(id)) {
      setHostel(null);
      setNotFound(true);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    getJson<Hostel>(`/hostels/${id}`)
      .then((result) => {
        if (!cancelled) setHostel(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setHostel(null);
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, city, getHostelsForCity]);

  return { hostel, loading, error, notFound };
}
