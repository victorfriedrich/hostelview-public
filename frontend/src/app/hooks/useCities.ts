'use client';

import { useState, useEffect } from 'react';
import { City, getJson } from '../api';

/** Every city with hostels (GET /cities), with its map figures. */
export function useCities() {
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCities = async () => {
      setLoading(true);
      setError(null);
      try {
        setCities(await getJson<City[]>('/cities'));
      } catch (err) {
        console.error('Error fetching cities:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };

    fetchCities();
  }, []);

  return { cities, loading, error };
}
