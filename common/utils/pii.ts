const REDACTIONS: Array<[RegExp, string]> = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email redacted]'],
  [/\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g, '[phone redacted]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn redacted]'],
  [/\b(?:\d[ -]*?){13,16}\b/g, '[card redacted]'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip redacted]'],
];

export const redactPII = (text: string): string => {
  let result = text;
  for (const [pattern, replacement] of REDACTIONS) {
    result = result.replace(pattern, replacement);
  }
  return result;
};