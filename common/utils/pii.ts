const REDACTIONS: Array<[RegExp, string]> = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email redacted]'],
  [/\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g, '[phone redacted]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn redacted]'],
  [/\b(?:\d[ -]*?){13,16}\b/g, '[card redacted]'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip redacted]'],
];

/**
 * Replaces PII in text. Exact `preserve` values are hidden behind placeholders
 * while redaction runs and restored afterwards, so identifiers such as device
 * serials are not mistaken for phone numbers.
 */
export const redactPII = (text: string, preserve: readonly string[] = []): string => {
  const placeholders = new Map<string, string>();
  let result = text;

  [...new Set(preserve)]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .sort((left, right) => right.length - left.length)
    .forEach((value, index) => {
      const token = `\u0000PII_KEEP_${index}\u0000`;
      placeholders.set(token, value);
      result = result.split(value).join(token);
    });

  for (const [pattern, replacement] of REDACTIONS) {
    result = result.replace(pattern, replacement);
  }

  for (const [token, value] of placeholders) {
    result = result.split(token).join(value);
  }
  return result;
};
