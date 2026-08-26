import { defaultEndpoints } from './constants';
import { runtimeFetch } from './runtime';

// const baseUrl = `http://localhost:9000`;
// let baseUrl = SERVER.main[0];
// const baseUrl = `https://p.reactnative.cn/api`;

export function promiseAny<T>(promises: Promise<T>[]) {
  return new Promise<T>((resolve, reject) => {
    let count = 0;

    for (const promise of promises) {
      Promise.resolve(promise)
        .then(resolve)
        .catch(() => {
          count++;
          if (count === promises.length) {
            reject(new Error('All promises were rejected'));
          }
        });
    }
  });
}

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
// and the losing pings are aborted. Falls back to urls[0] when all fail.
export const testUrls = async (
  urls?: string[],
  hedgeDelayMs: number = HEDGE_DELAY_MS,
) => {
  if (!urls?.length) {
    return null;
  }
  return new Promise<string>((resolve) => {
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
      resolve(winner ?? urls[0]);
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

let baseUrlPromise: Promise<string> | undefined;

async function resolveBaseUrl(): Promise<string> {
  const testEndpoint = process.env.PUSHY_REGISTRY || process.env.RNU_API;
  if (testEndpoint) {
    return testEndpoint;
  }
  const ret = await testUrls(defaultEndpoints.map((url) => `${url}/status`));
  let baseUrl = defaultEndpoints[0];
  if (ret) {
    // remove /status
    baseUrl = ret.replace('/status', '');
  }
  // console.log('baseUrl', baseUrl);
  return baseUrl;
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
