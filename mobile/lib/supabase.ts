// react-native has no global URL implementation; supabase-js needs one.
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

// Injected by app.config.ts from the environment (never hardcoded here).
const extra = Constants.expoConfig?.extra ?? {};
const supabaseUrl = (extra.supabaseUrl as string | undefined) ?? '';
const supabaseAnonKey = (extra.supabaseAnonKey as string | undefined) ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  // Surface a clear message in the dev logs if .env wasn't picked up, rather
  // than failing later with an opaque network error.
  console.warn(
    'Supabase config missing. Set SUPABASE_URL and SUPABASE_ANON_KEY in mobile/.env, then restart Expo.',
  );
}

// AsyncStorage persists the auth session across app restarts.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
