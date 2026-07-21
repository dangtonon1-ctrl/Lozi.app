import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { supabase } from './supabase';

// Live catalog updates, independent of the initial load strategy. Subscribes to
// `products` realtime changes and calls `onChange` (debounced) so the current
// screen can refresh. Pauses — unsubscribes — when the app is backgrounded to save
// battery/data, and resubscribes on foreground (owner decision 2026-07-19).
export function useProductsRealtime(onChange: () => void) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cbRef.current(), 800);
    };
    const subscribe = () => {
      if (channel) return;
      channel = supabase
        .channel('home-products')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, fire)
        .subscribe();
    };
    const unsubscribe = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    };

    subscribe();
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') subscribe();
      else unsubscribe();
    });

    return () => {
      unsubscribe();
      appSub.remove();
    };
  }, []);
}
