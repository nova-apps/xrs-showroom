/**
 * Hook to subscribe to the scenes list in realtime.
 */

'use client';

import { useState, useEffect } from 'react';
import { subscribeSceneList } from '@/lib/scenes';

export function useSceneList() {
  const [scenes, setScenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let unsubscribe;
    try {
      unsubscribe = subscribeSceneList(
        (list) => {
          setScenes(list);
          setError(null);
          setLoading(false);
        },
        (err) => {
          setError(err);
          setLoading(false);
        }
      );
    } catch (err) {
      setError(err);
      setLoading(false);
    }
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  return { scenes, loading, error };
}
