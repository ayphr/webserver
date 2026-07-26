export type TelemetryRecord = {
  deviceId: number;
  timestamp: Date;
  temperature: number;
  humidity: number;
  airPressure: number;
  location?: { lat: number; lon: number };
};
