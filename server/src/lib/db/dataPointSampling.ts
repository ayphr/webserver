import type { DataPoint } from '@common';
import type { DataPointDocument } from './internal';

export function toDataPoint(document: Pick<DataPointDocument, 'timestamp' | 'temperature' | 'humidity' | 'airPressure'>): DataPoint {
  return {
    timestamp: document.timestamp,
    temperature: document.temperature,
    humidity: document.humidity,
    airPressure: document.airPressure,
  };
}

export function sampleDataPoints(documents: DataPointDocument[], maxPoints: number): DataPoint[] {
  if (documents.length <= maxPoints) return documents.map(toDataPoint);

  const step = documents.length / maxPoints;
  const sampled: DataPoint[] = [];
  for (let index = 0; index < maxPoints; index += 1) {
    const document = documents[Math.min(Math.floor(index * step), documents.length - 1)];
    if (document) sampled.push(toDataPoint(document));
  }

  const lastDocument = documents[documents.length - 1];
  const lastSampled = sampled[sampled.length - 1];
  if (lastDocument && lastSampled && lastSampled.timestamp.getTime() !== lastDocument.timestamp.getTime()) {
    sampled[sampled.length - 1] = toDataPoint(lastDocument);
  }

  return sampled;
}

export function sortDataPoints(points: DataPoint[]): DataPoint[] {
  return [...points].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}
