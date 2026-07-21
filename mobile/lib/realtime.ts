import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { supabase } from './supabase';

// TEMPORARY DIAGNOSTIC (2026-07-21): realtime produced no live updates on device.
// Server-side checks passed (products IS in supabase_realtime, replica identity
// default, retail rows RLS-authorized for anon+authenticated), so this exposes the
// CLIENT side: does the channel reach SUBSCRIBED, and does any payload actually
// arrive on a product change? Remove `RealtimeDebug`/the return value and the extra
// state once the cause is confirmed.
export type RealtimeDebug = {
  status: string; // last channel status: idle | SUBSCRIBED | CHANNEL_ERROR | TIMED_OUT | CLOSED
  events: number; // count of postgres_changes payloads received
  lastAt: number | null; // Date.now() of the last payload
  hasToken: boolean; // whether the realtime socket carries an access token
};

// Live catalog updates, independent of the initial load strategy. Subscribes to
// `products` realtime changes and calls `onChange` (debounced) so the current
// screen can refresh. Pauses — unsubscribes — when the app is backgrounded to save
// battery/data, and resubscribes on foreground (owner decision 2026-07-19).
export function useProductsRealtime(onChange: () => void): RealtimeDebug {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  const [debug, setDebug] = useState<RealtimeDebug>({ status: 'idle', events: 0, lastAt: null, hasToken: false });

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fire = (payload?: { eventType?: string; new?: { id?: string }; old?: { id?: string } }) => {
      const id = payload?.new?.id ?? payload?.old?.id;
      console.log('[RT] payload', payload?.eventType, id);
      setDebug((d) => ({ ...d, events: d.events + 1, lastAt: Date.now() }));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cbRef.current(), 800);
    };
    const subscribe = () => {
      if (channel) return;
      const rc = supabase.realtime as unknown as { accessTokenValue?: string; accessToken?: string };
      const tok = rc?.accessTokenValue ?? (typeof rc?.accessToken === 'string' ? rc.accessToken : undefined);
      setDebug((d) => ({ ...d, hasToken: !!tok, status: 'subscribing' }));
      console.log('[RT] subscribing; hasToken =', !!tok);
      channel = supabase
        .channel('home-products')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, fire)
        .subscribe((status) => {
          console.log('[RT] status', status);
          setDebug((d) => ({ ...d, status }));
        });
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

  return debug;
}
