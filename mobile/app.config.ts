import { ExpoConfig, ConfigContext } from 'expo/config';

// Dynamic Expo config. Extends the static app.json and injects the Supabase
// connection into `expo.extra`, where the app reads it at runtime via
// expo-constants (see lib/supabase.ts). The URL and anon key are never
// hardcoded here — they come from the environment (SUPABASE_URL /
// SUPABASE_ANON_KEY), loaded by Expo from mobile/.env, which is git-ignored.
// Copy .env.example to .env and fill in the values.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'لوزي',
  slug: config.slug ?? 'lozi',
  plugins: [...(config.plugins ?? []), 'expo-router'],
  extra: {
    ...config.extra,
    supabaseUrl: process.env.SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '',
  },
});
