export type JsonObject = Record<string, unknown>;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireJsonObject(value: unknown, message = 'request body must be an object'): JsonObject {
  if (!isJsonObject(value)) throw new ValidationError(message);
  return value;
}

export function optionalString(
  object: JsonObject,
  key: string,
  options: { maxLength?: number; trim?: boolean } = {},
): string | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new ValidationError(`${key} must be a string`);
  const result = options.trim === false ? value : value.trim();
  if (options.maxLength !== undefined && result.length > options.maxLength) {
    throw new ValidationError(`${key} is too long`);
  }
  return result;
}

export function requiredString(
  object: JsonObject,
  key: string,
  options: { maxLength?: number; trim?: boolean } = {},
): string {
  const value = optionalString(object, key, options);
  if (!value) throw new ValidationError(`${key} is required`);
  return value;
}

export function optionalBoolean(object: JsonObject, key: string): boolean | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new ValidationError(`${key} must be a boolean`);
  return value;
}

export function optionalNumber(object: JsonObject, key: string): number | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`${key} must be a finite number`);
  }
  return value;
}
