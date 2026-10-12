"use client"
import React, { createContext, useContext, useState, useCallback } from 'react';
import type { Hostel } from './api';

export type HostelDataCache = {
  [city: string]: Hostel[];
};

interface HostelDataContextType {
  cache: HostelDataCache;
  setHostelsForCity: (city: string, hostels: Hostel[]) => void;
  getHostelsForCity: (city: string) => Hostel[] | undefined;
}

const HostelDataContext = createContext<HostelDataContextType | undefined>(undefined);

export const HostelDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cache, setCache] = useState<HostelDataCache>({});

  const setHostelsForCity = useCallback((city: string, hostels: Hostel[]) => {
    setCache(prev => ({ ...prev, [city]: hostels }));
  }, []);

  const getHostelsForCity = useCallback((city: string) => {
    return cache[city];
  }, [cache]);

  return (
    <HostelDataContext.Provider value={{ cache, setHostelsForCity, getHostelsForCity }}>
      {children}
    </HostelDataContext.Provider>
  );
};

export function useHostelDataContext() {
  const ctx = useContext(HostelDataContext);
  if (!ctx) throw new Error('useHostelDataContext must be used within a HostelDataProvider');
  return ctx;
} 