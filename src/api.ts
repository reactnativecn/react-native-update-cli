import fetch from 'node-fetch';
import fs from 'node:fs';
import util from 'node:util';
import path from 'node:path';
import ProgressBar from 'progress';
import packageJson from '../package.json';
import tcpp from 'tcp-ping';
import filesizeParser from 'filesize-parser';
import {
  pricingPageUrl,
  credentialFile,
  defaultEndpoint,
} from './utils/constants';
import type { Session } from 'types';
import FormData from 'form-data';
import { t } from './utils/i18n';

const tcpPing = util.promisify(tcpp.ping);

let session: Session | undefined;
let savedSession: Session | undefined;

const host =
  process.env.PUSHY_REGISTRY || process.env.RNU_API || defaultEndpoint;

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
  const resp = await fetch(url, options);
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
    query(host + api, {
      method,
      headers: {
        'User-Agent': userAgent,
        'X-AccessToken': session ? session.token : '',
      },
    });
}

function queryWithBody(method: string) {
  return (api: string, body?: Record<string, any>) =>
    query(host + api, {
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
