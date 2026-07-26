export function countryCodeToFlag(code?: string): string | null {
  if (!code || code.length !== 2) return null;
  const upper = code.toUpperCase();
  const points = [...upper].map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...points);
}
