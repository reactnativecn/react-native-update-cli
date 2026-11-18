import { defaultEndpoints } from './constants';
import { runtimeFetch } from './runtime';

export const ping = async (url: string, signal?: AbortSignal) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await (Promise.race([
      runtimeFetch(url, {
        method: 'HEAD',
        signal,
      }).then(({ status }) => {
        if (status === 200) {
          return url;
        }
        throw new Error('ping failed');
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('ping timeout'));
        }, 5000);
      }),
    ]) as Promise<string | null>);
  } finally {
    // clear the timer so it doesn't keep the process alive for 5s
    clearTimeout(timer);
  }
};

const HEDGE_DELAY_MS = 250;

// Hedged race instead of pinging every endpoint at once: the preferred (first)
// url is tried immediately, each following one only after HEDGE_DELAY_MS of
// silence (or immediately when a previous ping failed). The first success wins
// and the losing pings are aborted. Resolves null when every ping fails.
export const pickReachableUrl = (
  urls: string[],
  hedgeDelayMs: number = HEDGE_DELAY_MS,
) => {
  if (!urls.length) {
    return Promise.resolve(null);
  }
  return new Promise<string | null>((resolve) => {
    const controllers: AbortController[] = [];
    let nextIndex = 0;
    let pending = 0;
    let settled = false;
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (
      winner: string | null,
      winnerController?: AbortController,
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      if (hedgeTimer) {
        clearTimeout(hedgeTimer);
      }
      for (const controller of controllers) {
        if (controller !== winnerController) {
          controller.abort();
        }
      }
      resolve(winner);
    };

    const launchNext = () => {
      if (hedgeTimer) {
        clearTimeout(hedgeTimer);
        hedgeTimer = undefined;
      }
      if (settled || nextIndex >= urls.length) {
        return;
      }
      const url = urls[nextIndex++];
      const controller = new AbortController();
      controllers.push(controller);
      pending++;
      ping(url, controller.signal).then(
        () => finish(url, controller),
        () => {
          pending--;
          if (settled) {
            return;
          }
          if (nextIndex < urls.length) {
            // A failure frees its slot: hedge the next url right away.
            launchNext();
          } else if (pending === 0) {
            finish(null);
          }
        },
      );
      if (!settled && nextIndex < urls.length) {
        hedgeTimer = setTimeout(launchNext, hedgeDelayMs);
      }
    };

    launchNext();
  });
};

/** Like pickReachableUrl, but falls back to urls[0] when all fail. */
export const testUrls = async (
  urls?: string[],
  hedgeDelayMs: number = HEDGE_DELAY_MS,
) => {
  if (!urls?.length) {
    return null;
  }
  return (await pickReachableUrl(urls, hedgeDelayMs)) ?? urls[0];
};

let baseUrlPromise: Promise<string> | undefined;
let noEndpointReachable = false;

/**
 * True when no default endpoint answered the ping and the API base url is the
 * unverified fallback (defaultEndpoints[0]): a request failing there means the
 * machine reaches none of the endpoints, not that this one host is down.
 */
export const isBaseUrlUnreachableFallback = () => noEndpointReachable;

async function resolveBaseUrl(): Promise<string> {
  const testEndpoint = process.env.PUSHY_REGISTRY || process.env.RNU_API;
  if (testEndpoint) {
    return testEndpoint;
  }
  const ret = await pickReachableUrl(
    defaultEndpoints.map((url) => `${url}/status`),
  );
  if (!ret) {
    noEndpointReachable = true;
    return defaultEndpoints[0];
  }
  // remove /status
  return ret.replace('/status', '');
}

/**
 * The API base url: the env override, or the first default endpoint that
 * answers a HEAD ping. Resolved lazily on the first API call (offline commands
 * such as `hdiff`/`help` never ping) and memoized for the process lifetime.
 */
export const getBaseUrl = (): Promise<string> => {
  if (!baseUrlPromise) {
    baseUrlPromise = resolveBaseUrl();
  }
  return baseUrlPromise;
};
