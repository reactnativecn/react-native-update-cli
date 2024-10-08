import fetch from 'node-fetch';
const defaultEndpoint = 'https://update.reactnative.cn/api';
let host = process.env.PUSHY_REGISTRY || defaultEndpoint;
import fs from 'fs';
import request from 'request';
import ProgressBar from 'progress';
import packageJson from '../package.json';
import tcpp from 'tcp-ping';
import util from 'util';
import path from 'path';
import filesizeParser from 'filesize-parser';
import { pricingPageUrl } from './utils';

const tcpPing = util.promisify(tcpp.ping);

let session = undefined;
let savedSession = undefined;

const userAgent = `react-native-update-cli/${packageJson.version}`;

export const getSession = function () {
  return session;
};

export const replaceSession = function (newSession) {
  session = newSession;
};

export const loadSession = async function () {
  if (fs.existsSync('.update')) {
    try {
      replaceSession(JSON.parse(fs.readFileSync('.update', 'utf8')));
      savedSession = session;
    } catch (e) {
      console.error(
        'Failed to parse file `.update`. Try to remove it manually.',
      );
      throw e;
    }
  }
};

export const saveSession = function () {
  // Only save on change.
  if (session !== savedSession) {
    const current = session;
    const data = JSON.stringify(current, null, 4);
    fs.writeFileSync('.update', data, 'utf8');
    savedSession = current;
  }
};

export const closeSession = function () {
  if (fs.existsSync('.update')) {
    fs.unlinkSync('.update');
    savedSession = undefined;
  }
  session = undefined;
  host = process.env.PUSHY_REGISTRY || defaultEndpoint;
};

async function query(url, options) {
  const resp = await fetch(url, options);
  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`Server error: ${text}`);
  }

  if (resp.status !== 200) {
    throw Object.assign(new Error(json.message || json.error), {
      status: resp.status,
    });
  }
  return json;
}

function queryWithoutBody(method) {
  return function (api) {
    return query(host + api, {
      method,
      headers: {
        'User-Agent': userAgent,
        'X-AccessToken': session ? session.token : '',
      },
    });
  };
}

function queryWithBody(method) {
  return function (api, body) {
    return query(host + api, {
      method,
      headers: {
        'User-Agent': userAgent,
        'Content-Type': 'application/json',
        'X-AccessToken': session ? session.token : '',
      },
      body: JSON.stringify(body),
    });
  };
}

export const get = queryWithoutBody('GET');
export const post = queryWithBody('POST');
export const put = queryWithBody('PUT');
export const doDelete = queryWithBody('DELETE');

export async function uploadFile(fn, key) {
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
      if (isNaN(pingResult.avg) || pingResult.avg > 150) {
        realUrl = backupUrl;
      }
    }
    // console.log({realUrl});
  }

  const fileSize = fs.statSync(fn).size;
  if (maxSize && fileSize > filesizeParser(maxSize)) {
    throw new Error(
      `此文件大小${(fileSize / 1048576).toFixed(
        1,
      )}m, 超出当前额度${maxSize}。您可以考虑升级付费业务以提升此额度。详情请访问: ${pricingPageUrl}`,
    );
  }

  const bar = new ProgressBar('  上传中 [:bar] :percent :etas', {
    complete: '=',
    incomplete: ' ',
    total: fileSize,
  });

  const info = await new Promise((resolve, reject) => {
    if (key) {
      formData.key = key;
    }
    formData.file = fs.createReadStream(fn);

    formData.file.on('data', function (data) {
      bar.tick(data.length);
    });
    request.post(
      realUrl,
      {
        formData,
      },
      (err, resp, body) => {
        if (err) {
          return reject(err);
        }
        if (resp.statusCode > 299) {
          return reject(
            Object.assign(new Error(JSON.stringify(body)), {
              status: resp.statusCode,
            }),
          );
        }
        resolve({ hash: formData.key });
      },
    );
  });
  return info;
}
