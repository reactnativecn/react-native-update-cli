import fetch from 'node-fetch';
import { defaultEndpoints } from './constants';

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
  let pingFinished = false;
  return Promise.race([
    fetch(url, {
      method: 'HEAD',
    })
      .then(({ status, statusText }) => {
        pingFinished = true;
        if (status === 200) {
          // console.log('ping success', url);
          return url;
        }
        // console.log('ping failed', url, status, statusText);
        throw new Error('ping failed');
      })
      .catch((e) => {
        pingFinished = true;
        // console.log('ping error', url, e);
        throw new Error('ping error');
      }),
    new Promise((_, reject) =>
      setTimeout(() => {
        reject(new Error('ping timeout'));
        if (!pingFinished) {
          // console.log('ping timeout', url);
        }
      }, 2000),
    ),
  ]) as Promise<string | null>;
};

export const testUrls = async (urls?: string[]) => {
  if (!urls?.length) {
    return null;
  }
  const ret = await promiseAny(urls.map(ping));
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
