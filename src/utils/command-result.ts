import type { CommandResult } from '../types';

export function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function runAsCommandResult<T>(
  task: () => Promise<T>,
  fallbackError: string,
  mapSuccess?: (result: T) => unknown,
): Promise<CommandResult> {
  try {
    const result = await task();
    return {
      success: true,
      data: mapSuccess ? mapSuccess(result) : result,
    };
  } catch (error) {
    return {
      success: false,
      error: toErrorMessage(error, fallbackError),
    };
  }
}
