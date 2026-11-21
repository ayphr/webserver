/** Field references inside a condition block must be prefixed with the lambda variable. */
export function isLambdaFieldReference(field: string, varName: string): boolean {
  const prefix = `${varName}.`;
  return field.startsWith(prefix) && field.length > prefix.length;
}

function lambdaFieldMessage(varName: string, position?: number): string {
  const guidance = `Field references must include the lambda variable (for example ${varName}.temperature)`;
  return typeof position === 'number' ? `${guidance} at position ${position}` : guidance;
}

export function assertLambdaField(field: string, varName: string, position?: number): void {
  if (!isLambdaFieldReference(field, varName)) {
    throw new Error(lambdaFieldMessage(varName, position));
  }
}

/** Removes the required lambda prefix, leaving the field path relative to the point. */
export function stripLambdaPrefix(field: string, varName: string): string {
  assertLambdaField(field, varName);
  return field.slice(varName.length + 1);
}
