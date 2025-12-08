import fs from 'fs';
import path from 'path';
import util from 'util';
import filesizeParser from 'filesize-parser';
import FormData from 'form-data';
import fetch from 'node-fetch';
import ProgressBar from 'progress';
import tcpp from 'tcp-ping';
import { getBaseUrl } from 'utils/http-helper';
import packageJson from '../package.json';
import type { Package, Session } from './types';
import { credentialFile, pricingPageUrl } from './utils/constants';
import { t } from './utils/i18n';

const tcpPing = util.promisify(tcpp.ping);

let session: Session | undefined;
let savedSession: Session | undefined;

const userAgent = `react-native-update-cli/${packageJson.version}`;

export const getSession = () => session;

export const replaceSession = (newSession: { token: string }) => {
  session = newSession;
};

export const loadSession = async () => {
  if (fs.existsSync(credentialFile)) {
    try {
      replaceSession(JSON.parse(fs.readFileSync(credentialFile, 'utf8')));
      savedSession = session;
    } catch (e) {
      console.error(
        `Failed to parse file ${credentialFile}. Try to remove it manually.`,
      );
      throw e;
    }
  }
};

export const saveSession = () => {
  // Only save on change.
  if (session !== savedSession) {
    const current = session;
    const data = JSON.stringify(current, null, 4);
    fs.writeFileSync(credentialFile, data, 'utf8');
    savedSession = current;
  }
};

export const closeSession = () => {
  if (fs.existsSync(credentialFile)) {
    fs.unlinkSync(credentialFile);
    savedSession = undefined;
  }
  session = undefined;
};

async function query(url: string, options: fetch.RequestInit) {
  const baseUrl = await getBaseUrl;
  const fullUrl = `${baseUrl}${url}`;
  const resp = await fetch(fullUrl, options);
  const text = await resp.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch (e) {}

  if (resp.status !== 200) {
    const message = json?.message || resp.statusText;
    if (resp.status === 401) {
      throw new Error(t('loginExpired'));
    }
    throw new Error(message);
  }
  return json;
}

function queryWithoutBody(method: string) {
  return (api: string) =>
    query(api, {
      method,
      headers: {
        'User-Agent': userAgent,
        'X-AccessToken': session ? session.token : '',
      },
    });
}

function queryWithBody(method: string) {
  return (api: string, body?: Record<string, any>) =>
    query(api, {
      method,
      headers: {
        'User-Agent': userAgent,
        'Content-Type': 'application/json',
        'X-AccessToken': session ? session.token : '',
      },
      body: JSON.stringify(body),
    });
}

export const get = queryWithoutBody('GET');
export const post = queryWithBody('POST');
export const put = queryWithBody('PUT');
export const doDelete = queryWithBody('DELETE');

export async function uploadFile(fn: string, key?: string) {
  const { url, backupUrl, formData, maxSize } = await post('/upload', {
    ext: path.extname(fn),
  });
  let realUrl = url;
  if (backupUrl) {
    // @ts-ignore
    if (global.USE_ACC_OSS) {
      realUrl = backupUrl;
    } else {
      const pingResult = await tcpPing({
        address: url.replace('https://', ''),
        attempts: 4,
        timeout: 1000,
      });
      // console.log({pingResult});
      if (Number.isNaN(pingResult.avg) || pingResult.avg > 150) {
        realUrl = backupUrl;
      }
    }
    // console.log({realUrl});
  }

  const fileSize = fs.statSync(fn).size;
  if (maxSize && fileSize > filesizeParser(maxSize)) {
    const readableFileSize = `${(fileSize / 1048576).toFixed(1)}m`;
    throw new Error(
      t('fileSizeExceeded', {
        fileSize: readableFileSize,
        maxSize,
        pricingPageUrl,
      }),
    );
  }

  const bar = new ProgressBar('  Uploading [:bar] :percent :etas', {
    complete: '=',
    incomplete: ' ',
    total: fileSize,
  });

  const form = new FormData();

  for (const [k, v] of Object.entries(formData)) {
    form.append(k, v);
  }
  const fileStream = fs.createReadStream(fn);
  fileStream.on('data', (data) => {
    bar.tick(data.length);
  });

  if (key) {
    form.append('key', key);
  }
  form.append('file', fileStream);

  const res = await fetch(realUrl, {
    method: 'POST',
    body: form,
  });

  if (res.status > 299) {
    throw new Error(`${res.status}: ${res.statusText}`);
  }

  // const body = await response.json();
  return { hash: key || formData.key };
}

export const getAllPackages = async (appId: string) => {
  const { data } = await get(`/app/${appId}/package/list?limit=1000`);
  return data as Package[] | undefined | null;
};
