import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  type NativeSyntheticEvent,
  type StyleProp,
  type TargetedEvent,
  type ViewStyle,
} from 'react-native';

// True while the software keyboard is on screen. Auth screens use it to shrink
// or hide the brand mark so the focused field isn't pushed under the keyboard.
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

export type InputFocusHandler = (e: NativeSyntheticEvent<TargetedEvent>) => void;

// Standard auth-screen keyboard handling — JS-only, no native module. A
// KeyboardAvoidingView (padding on iOS; Android relies on the app.json
// android.softwareKeyboardLayoutMode:'resize' native flag, shipping in the next
// build) wraps a ScrollView that keeps taps working
// (keyboardShouldPersistTaps='handled' — without it the first tap on a submit
// button only dismisses the keyboard) and dismisses on drag. The render-prop
// hands children an `onInputFocus` to wire onto each TextInput; on focus it
// scrolls the focused native input above the keyboard.
export function KeyboardAwareScreen({
  children,
  contentContainerStyle,
}: {
  children: (onInputFocus: InputFocusHandler) => ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  const scrollRef = useRef<ScrollView>(null);

  const onInputFocus = useCallback<InputFocusHandler>((e) => {
    const node = e?.nativeEvent?.target;
    if (node == null) return;
    // Defer a frame so keyboard metrics are ready, then bring the focused native
    // input above the keyboard. This ScrollView method isn't in the public TS
    // types, so reach it through a narrow cast; optional-chaining makes it a safe
    // no-op if it's ever unavailable (the KAV + logo-shrink still free the field).
    requestAnimationFrame(() => {
      const sv = scrollRef.current as unknown as {
        scrollResponderScrollNativeHandleToKeyboard?: (n: number, offset: number, prevent: boolean) => void;
      } | null;
      sv?.scrollResponderScrollNativeHandleToKeyboard?.(node, 96, true);
    });
  }, []);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[{ flexGrow: 1, paddingBottom: 40 }, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {children(onInputFocus)}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
