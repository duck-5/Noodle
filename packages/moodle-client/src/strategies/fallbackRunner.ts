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
    if (strategy.isOperationSupported && !strategy.isOperationSupported(operationName)) {
      if (devMode) {
        if (strategy.name === 'REST') {
          console.log(`[MoodleClient] REST strategy in 1-hour cooldown (mobile plugin unavailable). Skipping to next fallback.`);
        }
      }
      continue;
    }

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

      if (
        strategy.name === 'REST' &&
        err instanceof MoodleApiError &&
        (err.errorcode === 'invalidtoken' || err.errorcode === 'accessexception')
      ) {
        if (devMode) {
          console.log(`[MoodleClient] REST token expired/invalid. Attempting to automatically refresh token via scraper...`);
        }
        let newToken: string | null = null;
        for (const s of strategies) {
          if (s.getMobileToken) {
            try {
              newToken = await s.getMobileToken();
              break;
            } catch (tokenErr) {
              if (devMode) console.warn(`[MoodleClient] Failed to refresh token via '${s.name}':`, tokenErr);
            }
          }
        }
        
        if (newToken) {
          if (devMode) console.log(`[MoodleClient] Successfully generated new token. Retrying ${operationName} with REST...`);
          for (const s of strategies) {
            if (s.setToken) s.setToken(newToken);
          }
          // Reset cooldown if it was applied
          if ((strategy as any).constructor?.resetCooldown) {
            (strategy as any).constructor.resetCooldown();
          }
          try {
            const retryResult = await operation(strategy);
            if (devMode) console.log(`[MoodleClient] Succeeded ${operationName} with strategy '${strategy.name}' after token refresh.`);
            return retryResult;
          } catch (retryErr: any) {
            if (devMode) console.warn(`[MoodleClient] Strategy '${strategy.name}' failed again after token refresh:`, retryErr?.message || retryErr);
            err = retryErr;
          }
        }
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
