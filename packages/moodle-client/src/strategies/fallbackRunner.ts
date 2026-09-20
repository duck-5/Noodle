import { MoodleApiError } from '../moodleApi.js';
import { IMoodleStrategy, UnsupportedStrategyError } from './types.js';

export async function executeWithFallback<T>(
  operationName: string,
  strategies: IMoodleStrategy[],
  operation: (strategy: IMoodleStrategy) => Promise<T>,
  devMode: boolean = true
): Promise<T> {
  const errors: Array<{ strategy: string; error: any }> = [];

  for (const strategy of strategies) {
    try {
      if (devMode) {
        console.log(`[MoodleClient] Attempting ${operationName} using strategy '${strategy.name}'...`);
      }
      const result = await operation(strategy);
      if (devMode && strategy.name !== 'REST') {
        console.log(`[MoodleClient] Succeeded ${operationName} with fallback strategy '${strategy.name}'.`);
      }
      return result;
    } catch (err: any) {
      if (err instanceof UnsupportedStrategyError) {
        if (devMode) {
          console.log(
            `[MoodleClient] Strategy '${strategy.name}' does not support ${operationName}: ${err.message}. Trying next fallback.`
          );
        }
        continue;
      }

      // If the REST token is expired/invalid, do not mask it with fallback failure;
      // re-throw immediately so silent re-authentication or token refresh can trigger.
      if (err instanceof MoodleApiError && err.errorcode === 'invalidtoken') {
        if (devMode) {
          console.warn(`[MoodleClient] Strategy '${strategy.name}' reported invalidtoken. Re-throwing for re-auth.`);
        }
        throw err;
      }

      errors.push({ strategy: strategy.name, error: err });
      if (devMode) {
        console.warn(
          `[MoodleClient] Strategy '${strategy.name}' failed for ${operationName}:`,
          err?.message || err
        );
      }
    }
  }

  // If any strategy threw a MoodleApiError (e.g. accessexception or servicenotavailable),
  // preserve it as the thrown error so callers can inspect errorcode.
  const primaryMoodleError = errors.find((e) => e.error instanceof MoodleApiError)?.error;
  if (primaryMoodleError) {
    throw primaryMoodleError;
  }

  const errorSummary = errors
    .map((e) => `${e.strategy}: ${e.error?.message || e.error}`)
    .join('; ');
  throw new Error(`All strategies failed for ${operationName} [${errorSummary}]`);
}
