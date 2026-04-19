'use client';

import { useState, useEffect } from 'react';
import { subscribePresets } from '@/lib/presets';

export function usePresets() {
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribePresets((list) => {
      setPresets(list);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  return { presets, loading };
}
