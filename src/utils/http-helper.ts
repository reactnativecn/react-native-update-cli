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

export const ping = async (url: string) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await (Promise.race([
      runtimeFetch(url, {
        method: 'HEAD',
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

export const testUrls = async (urls?: string[]) => {
  if (!urls?.length) {
    return null;
  }
  let ret: string | null = null;
  try {
    ret = await promiseAny(urls.map(ping));
  } catch (_e) {
    // fallback to urls[0]
  }
  if (ret) {
    return ret;
  }
  // console.log('all ping failed, use first url:', urls[0]);
  return urls[0];
};

export const getBaseUrl = (async () => {
  const testEndpoint = process.env.PUSHY_REGISTRY || process.env.RNU_API;
  if (testEndpoint) {
    return testEndpoint;
  }
  return testUrls(defaultEndpoints.map((url) => `${url}/status`)).then(
    (ret) => {
      let baseUrl = defaultEndpoints[0];
      if (ret) {
        // remove /status
        baseUrl = ret.replace('/status', '');
      }
      // console.log('baseUrl', baseUrl);
      return baseUrl;
    },
  );
})();
