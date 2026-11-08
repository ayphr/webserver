export const DEVICE_PERIODS = ['1h', '24h', '7d', '30d', 'all'] as const;

export type DevicePeriod = (typeof DEVICE_PERIODS)[number];

export function devicePeriodLabel(period: DevicePeriod): string {
  switch (period) {
    case '1h':
      return 'Past 1h';
    case '24h':
      return 'Past 24h';
    case '7d':
      return 'Past 7d';
    case '30d':
      return 'Past 30d';
    case 'all':
      return 'All Time';
  }
}
