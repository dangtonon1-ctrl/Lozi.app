import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';

import { fonts } from '../lib/theme';

// Minimal JS-only toast (no library). Wrap the app once in <ToastProvider>; call
// useToast().show(msg) to flash a message. Used for the "قريباً" +/♥ feedback so a
// tap gives visible acknowledgement instead of a silent dead button.
type ToastContextValue = { show: (message: string) => void };
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (m: string) => {
      setMessage(m);
      if (timer.current) clearTimeout(timer.current);
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 240, useNativeDriver: true }).start();
      }, 1600);
    },
    [opacity],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <Animated.View pointerEvents="none" style={[styles.toast, { opacity }]}>
        <Text style={styles.text}>{message}</Text>
      </Animated.View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 48,
    backgroundColor: 'rgba(44,39,28,0.94)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  text: { color: '#fff', fontSize: 15, fontFamily: fonts.bold, textAlign: 'center' },
});
