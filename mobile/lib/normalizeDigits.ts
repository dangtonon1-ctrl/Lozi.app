// Normalize Eastern Arabic-Indic (U+0660–U+0669) and Extended Arabic / Persian
// (U+06F0–U+06F9) digits to ASCII 0–9.
//
// Yemeni and other Arabic keyboards emit ٠١٢٣٤٥٦٧٨٩ / ۰۱۲۳۴۵۶۷۸۹ for numbers, but
// every downstream consumer (e164 phone formatting, validation, OTP codes, and
// later quantities and prices) matches on ASCII [0-9] and would silently drop
// non-Latin digits. Apply this at EVERY numeric input so state is always Latin.
// One helper — do not reimplement per screen.
export function normalizeDigits(input: string): string {
  if (!input) return input;
  return input.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660; // Persian block vs Arabic-Indic block
    return String.fromCharCode(code - base + 0x30); // → '0'..'9'
  });
}
