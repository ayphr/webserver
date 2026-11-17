export type DataPointRange = {
  since?: Date;
  until?: Date;
};

export function buildDataPointFilter(serial: number, range?: DataPointRange): Record<string, unknown> {
  const filter: Record<string, unknown> = { deviceSerial: serial };
  if (!range?.since && !range?.until) return filter;

  const timestamp: Record<string, Date> = {};
  if (range.since) timestamp.$gte = range.since;
  if (range.until) timestamp.$lte = range.until;
  filter.timestamp = timestamp;
  return filter;
}
