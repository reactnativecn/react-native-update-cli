export function getBooleanOption(
  options: Record<string, unknown>,
  key: string,
  fallback = false,
): boolean {
  const value = options[key];
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return fallback;
}

export function getStringOption(
  options: Record<string, unknown>,
  key: string,
  fallback = '',
): string {
  const value = options[key];
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

export function getOptionalStringOption(
  options: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = options[key];
  if (typeof value === 'string') {
    return value || undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

export function toObjectState<T extends Record<string, unknown>>(
  value: unknown,
  fallback: T,
): T {
  if (value && typeof value === 'object') {
    return value as T;
  }
  return fallback;
}
