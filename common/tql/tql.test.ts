import { describe, expect, it } from 'bun:test';
import {
  estimateQueryComputeUnits,
  evaluateQuery,
  parseQuery,
  validateQuery,
  type TelemetryPoint,
} from './index';

interface SensorData extends TelemetryPoint {
  tempC: number;
  humidity?: number | null;
  status?: string;
  pressure?: number;
  targetTemp?: number;
  device?: {
    model: string;
    battery: number;
  };
}

const mockDataset: SensorData[] = [
  {
    timestamp: 1700000000000,
    tempC: 20.0,
    humidity: 50,
    status: 'ACTIVE',
    pressure: 1013,
    targetTemp: 21.0,
    device: { model: 'ESP32-PRO', battery: 95 },
  },
  {
    timestamp: 1700000060000,
    tempC: 22.0,
    humidity: 55,
    status: 'ACTIVE',
    pressure: 1012,
    targetTemp: 21.0,
    device: { model: 'ESP32-PRO', battery: 90 },
  },
  {
    timestamp: 1700000120000,
    tempC: 25.5,
    humidity: 60,
    status: 'WARN_HIGH_TEMP',
    pressure: 1010,
    targetTemp: 21.0,
    device: { model: 'ESP32-LITE', battery: 80 },
  },
  {
    timestamp: 1700000180000,
    tempC: 30.0,
    humidity: null,
    status: 'CRITICAL',
    pressure: 1008,
    targetTemp: 21.0,
    device: { model: 'ESP32-LITE', battery: 40 },
  },
  {
    timestamp: 1700000240000,
    tempC: 18.0,
    humidity: 45,
    status: 'ACTIVE',
    pressure: 1015,
    targetTemp: 20.0,
    device: { model: 'ESP32-PRO', battery: 30 },
  },
];

type QueryRow = SensorData & Record<string, unknown>;

function evaluateRows(query: string): QueryRow[] {
  return evaluateQuery<SensorData>(query, mockDataset) as unknown as QueryRow[];
}

describe('TQL Query Engine', () => {
  describe('Query Roots & Actions', () => {
    it('findAll returns matching array of points', () => {
      const q = 'findAll(p -> {tempC > 21})';
      const results = evaluateQuery<SensorData>(q, mockDataset);
      expect(results.length).toBe(3);
      expect(results.map((r: SensorData) => r.tempC)).toEqual([22.0, 25.5, 30.0]);
    });

    it('findFirst returns first matching point', () => {
      const q = 'findFirst(p -> {status == "ACTIVE"})';
      const res = evaluateQuery<SensorData>(q, mockDataset);
      expect(res).not.toBeNull();
      expect(res.tempC).toBe(20.0);
    });

    it('findLast returns last matching point', () => {
      const q = 'findLast(p -> {status == "ACTIVE"})';
      const res = evaluateQuery<SensorData>(q, mockDataset);
      expect(res).not.toBeNull();
      expect(res.tempC).toBe(18.0);
    });

    it('count returns number of matches', () => {
      const q = 'count(p -> {tempC >= 22})';
      const count = evaluateQuery<SensorData>(q, mockDataset);
      expect(count).toBe(3);
    });

    it('exists returns boolean', () => {
      expect(evaluateQuery<SensorData>('exists(p -> {status == "CRITICAL"})', mockDataset)).toBe(true);
      expect(evaluateQuery<SensorData>('exists(p -> {tempC > 100})', mockDataset)).toBe(false);
    });
  });

  describe('Comparisons & Conditions', () => {
    it('handles standard comparisons and nested fields', () => {
      const q = 'findAll(p -> {device.battery >= 90})';
      const results = evaluateQuery<SensorData>(q, mockDataset);
      expect(results.length).toBe(2);
    });

    it('handles field-to-field comparisons', () => {
      const q = 'findAll(p -> {tempC > targetTemp})';
      const results = evaluateQuery<SensorData>(q, mockDataset);
      expect(results.length).toBe(3); // 22.0 > 21, 25.5 > 21, 30.0 > 21
    });

    it('handles absolute tolerance', () => {
      const q = 'findAll(p -> {tempC ~1~= 21})';
      const results = evaluateQuery<SensorData>(q, mockDataset);
      expect(results.length).toBe(2); // 20.0 and 22.0 are within [20, 22]
    });

    it('handles percentage tolerance', () => {
      const q = 'findAll(p -> {tempC ~10%~= 20})';
      const results = evaluateQuery<SensorData>(q, mockDataset);
      expect(results.length).toBe(3); // 20.0, 22.0, and 18.0 are all within [18, 22]
    });

    it('handles tolerance with dynamic setpoint field', () => {
      const q = 'findAll(p -> {tempC ~1~= targetTemp})';
      const results = evaluateQuery<SensorData>(q, mockDataset);
      expect(results.length).toBe(2); // 20.0 ~1~= 21 and 22.0 ~1~= 21
    });

    it('handles set membership in and not in', () => {
      const qIn = 'findAll(p -> {status in ["WARN_HIGH_TEMP", "CRITICAL"]})';
      expect(evaluateQuery<SensorData>(qIn, mockDataset).length).toBe(2);

      const qNotIn = 'findAll(p -> {status not in ["ACTIVE"]})';
      expect(evaluateQuery<SensorData>(qNotIn, mockDataset).length).toBe(2);
    });

    it('handles between range condition', () => {
      const q = 'findAll(p -> {tempC between 21 and 26})';
      const results = evaluateQuery<SensorData>(q, mockDataset);
      expect(results.length).toBe(2); // 22.0 and 25.5
    });

    it('handles null and presence checks', () => {
      const qNull = 'findAll(p -> {humidity is null})';
      expect(evaluateQuery<SensorData>(qNull, mockDataset).length).toBe(1);

      const qNotNull = 'findAll(p -> {humidity is not null})';
      expect(evaluateQuery<SensorData>(qNotNull, mockDataset).length).toBe(4);

      const qPresent = 'findAll(p -> {pressure exists})';
      expect(evaluateQuery<SensorData>(qPresent, mockDataset).length).toBe(5);
    });

    it('handles string pattern matching', () => {
      const qContains = 'findAll(p -> {status contains "WARN"})';
      expect(evaluateQuery<SensorData>(qContains, mockDataset).length).toBe(1);

      const qStarts = 'findAll(p -> {device.model startsWith "ESP32-PRO"})';
      expect(evaluateQuery<SensorData>(qStarts, mockDataset).length).toBe(3);

      const qEnds = 'findAll(p -> {device.model endsWith "LITE"})';
      expect(evaluateQuery<SensorData>(qEnds, mockDataset).length).toBe(2);

      const qRegex = 'findAll(p -> {status =~ "^(WARN|CRITICAL)"})';
      expect(evaluateQuery<SensorData>(qRegex, mockDataset).length).toBe(2);
    });

    it('handles logical NOT, AND, OR, and parentheses grouping', () => {
      const q = 'findAll(p -> !{status == "ACTIVE"} & ({device.battery < 50} | {tempC > 28}))';
      const results = evaluateQuery<SensorData>(q, mockDataset);
      expect(results.length).toBe(1);
      expect(results[0].status).toBe('CRITICAL');
    });
  });

  describe('Pipeline Operations', () => {
    it('sorts ascending and descending', () => {
      const qAsc = 'findAll(p -> {tempC > 0}) then sortAscending(tempC)';
      const resAsc = evaluateQuery<SensorData>(qAsc, mockDataset);
      expect(resAsc[0].tempC).toBe(18.0);
      expect(resAsc[resAsc.length - 1].tempC).toBe(30.0);

      const qDesc = 'findAll(p -> {tempC > 0}) then sortDescending(tempC)';
      const resDesc = evaluateQuery<SensorData>(qDesc, mockDataset);
      expect(resDesc[0].tempC).toBe(30.0);
    });

    it('supports limit, offset, and head/tail pagination', () => {
      const q1 = 'findAll(p -> {tempC > 0}) then limit(2)';
      expect(evaluateQuery(q1, mockDataset).length).toBe(2);

      const q2 = 'findAll(p -> {tempC > 0}) then offset(3) then limit(2)';
      expect(evaluateQuery(q2, mockDataset).length).toBe(2);

      const q3 = 'findAll(p -> {tempC > 0}) then head(1)';
      expect(evaluateQuery(q3, mockDataset)[0].tempC).toBe(20.0);

      const q4 = 'findAll(p -> {tempC > 0}) then tail(1)';
      expect(evaluateQuery(q4, mockDataset)[0].tempC).toBe(18.0);
    });

    it('projects fields with select and omit', () => {
      const qSelect = 'findAll(p -> {tempC > 0}) then select(tempC, status)';
      const resSelect = evaluateRows(qSelect);
      expect(resSelect[0]).toEqual({
        timestamp: 1700000000000,
        tempC: 20.0,
        status: 'ACTIVE',
      });

      const qOmit = 'findAll(p -> {tempC > 0}) then omit(device, pressure, targetTemp)';
      const resOmit = evaluateRows(qOmit);
      expect(resOmit[0].device).toBeUndefined();
      expect(resOmit[0].tempC).toBe(20.0);
    });

    it('renames properties with rename', () => {
      const q = 'findAll(p -> {tempC == 20.0}) then rename(tempC, celsius)';
      const res = evaluateRows(q);
      expect(res[0].celsius).toBe(20.0);
      expect(res[0].tempC).toBeUndefined();
    });

    it('fills missing values and clamps numeric boundaries', () => {
      const qFill = 'findAll(p -> {tempC > 0}) then fill(humidity, 0)';
      const resFill = evaluateRows(qFill);
      expect(resFill[3].humidity).toBe(0);

      const qClamp = 'findAll(p -> {tempC > 0}) then clamp(tempC, 20.0, 25.0)';
      const resClamp = evaluateRows(qClamp);
      expect(resClamp.map((r) => r.tempC)).toEqual([20.0, 22.0, 25.0, 25.0, 20.0]);
    });

    it('evaluates safe arithmetic with compute', () => {
      const q = 'findAll(p -> {tempC > 0}) then compute(tempF, (tempC * 1.8) + 32)';
      const res = evaluateRows(q);
      expect(res[0].tempF).toBeCloseTo(68.0);
      expect(res[1].tempF).toBeCloseTo(71.6);
    });

    it('computes rolling movingAverage', () => {
      const q = 'findAll(p -> {tempC > 0}) then movingAverage(tempC, 2, rollAvg)';
      const res = evaluateRows(q);
      expect(res[0].rollAvg).toBe(20.0);
      expect(res[1].rollAvg).toBe(21.0); // (20 + 22) / 2
      expect(res[2].rollAvg).toBe(23.75); // (22 + 25.5) / 2
    });

    it('computes diff and rate of change', () => {
      const qDiff = 'findAll(p -> {tempC > 0}) then diff(tempC, deltaTemp)';
      const resDiff = evaluateRows(qDiff);
      expect(resDiff[0].deltaTemp).toBe(0);
      expect(resDiff[1].deltaTemp).toBe(2.0); // 22 - 20

      const qRate = 'findAll(p -> {tempC > 0}) then rate(tempC, tempRate)';
      const resRate = evaluateRows(qRate);
      // delta 2.0 over 60 seconds = 2/60 = 0.0333 °C/sec
      expect(resRate[1].tempRate).toBeCloseTo(2 / 60);
    });

    it('aggregates with avg, min, max, sum, median, stddev', () => {
      const qAvg = 'findAll(p -> {tempC > 0}) then avg(tempC)';
      expect(evaluateQuery(qAvg, mockDataset)).toBeCloseTo(23.1);

      const qMin = 'findAll(p -> {tempC > 0}) then min(tempC)';
      expect(evaluateQuery(qMin, mockDataset)).toBe(18.0);

      const qMax = 'findAll(p -> {tempC > 0}) then max(tempC)';
      expect(evaluateQuery(qMax, mockDataset)).toBe(30.0);

      const qSum = 'findAll(p -> {tempC > 0}) then sum(tempC)';
      expect(evaluateQuery(qSum, mockDataset)).toBeCloseTo(115.5);
    });

    it('generates complete statistical summary with summary()', () => {
      const q = 'findAll(p -> {tempC > 0}) then summary(tempC, pressure)';
      const res = evaluateQuery<SensorData>(q, mockDataset) as unknown as {
        count: number;
        fields: Record<string, { count: number; min: number; max: number; avg: number }>;
      };
      expect(res.count).toBe(5);
      expect(res.fields.tempC.min).toBe(18.0);
      expect(res.fields.tempC.max).toBe(30.0);
      expect(res.fields.tempC.avg).toBeCloseTo(23.1);
      expect(res.fields.pressure.count).toBe(5);
    });

    it('groups by field using groupBy', () => {
      const q = 'findAll(p -> {tempC > 0}) then groupBy(status)';
      const groups = evaluateQuery<SensorData>(q, mockDataset) as unknown as Record<string, SensorData[]>;
      expect(Object.keys(groups).sort()).toEqual(['ACTIVE', 'CRITICAL', 'WARN_HIGH_TEMP']);
      expect(groups.ACTIVE.length).toBe(3);
    });

    it('resamples into time buckets', () => {
      const q = 'findAll(p -> {tempC > 0}) then resample("2m", "avg", tempC)';
      const res = evaluateRows(q);
      expect(res.length).toBeGreaterThan(0);
      expect(typeof res[0].timestamp).toBe('number');
      expect(typeof res[0].tempC).toBe('number');
    });
  });

  describe('Validation & AST Parsing', () => {
    it('validates correct and incorrect queries', () => {
      expect(validateQuery('findAll(p -> {tempC < 25})').valid).toBe(true);
      expect(validateQuery('findFirst(p -> {status == "ACTIVE"}) then limit(1)').valid).toBe(true);
      expect(validateQuery('invalid query here').valid).toBe(false);
      expect(validateQuery('findAll(p -> {tempC < })').valid).toBe(false);
    });

    it('parses AST properly', () => {
      const ast = parseQuery('findAll(pt -> {tempC ~0.5~= 22} & !{status == "OFFLINE"}) then sortDescending(timestamp) then limit(10)');
      expect(ast.action).toBe('findAll');
      expect(ast.varName).toBe('pt');
      expect(ast.filter.type).toBe('logical');
      expect(ast.pipeline.length).toBe(2);
      expect(ast.pipeline[0].type).toBe('sortDescending');
      expect(ast.pipeline[1].type).toBe('limit');
    });
  });

  describe('Compute unit estimation', () => {
    it('returns a breakdown for a valid query', () => {
      const estimate = estimateQueryComputeUnits('findAll(p -> {tempC > 20})');
      expect(estimate.units).toBeGreaterThan(0);
      expect(estimate.parts[0]?.label).toBe('Scan dataset');
      expect(estimate.parts.some((part) => part.label === 'Filter conditions')).toBe(true);
      expect(estimate.parts.reduce((sum, part) => sum + part.units, 0)).toBeCloseTo(estimate.units);
    });

    it('charges more for expensive pipeline operations', () => {
      const filtered = estimateQueryComputeUnits('findAll(p -> {tempC > 20})');
      const sorted = estimateQueryComputeUnits(
        'findAll(p -> {tempC > 20}) then sortDescending(timestamp)',
      );
      const resampled = estimateQueryComputeUnits(
        'findAll(p -> {tempC > 20}) then resample("1h", "avg", tempC)',
      );

      expect(sorted.units).toBeGreaterThan(filtered.units);
      expect(resampled.units).toBeGreaterThan(sorted.units);
      expect(sorted.parts.some((part) => part.label === 'sortDescending')).toBe(true);
      expect(resampled.parts.some((part) => part.label === 'resample')).toBe(true);
    });

    it('charges more for heavier filter conditions', () => {
      const simple = estimateQueryComputeUnits('findAll(p -> {tempC > 20})');
      const complex = estimateQueryComputeUnits(
        'findAll(p -> {tempC > 20} & {status == "ACTIVE"} & {tempC between 0 and 30})',
      );
      expect(complex.units).toBeGreaterThan(simple.units);
    });

    it('rejects invalid queries', () => {
      expect(() => estimateQueryComputeUnits('not a query')).toThrow();
    });
  });
});
