/**
 * Created by tdzl2003 on 2/13/16.
 */

const fetch = require('node-fetch');
const defaultEndpoint = 'http://u.reactnative.cn/api';
let host = process.env.PUSHY_REGISTRY || defaultEndpoint;
const fs = require('fs');
import request from 'request';
import ProgressBar from 'progress';
const packageJson = require('../package.json');
const tcpp = require('tcp-ping');
const util = require('util');
const path = require('path');
import filesizeParser from 'filesize-parser';
import { pricingPageUrl } from './utils';

const tcpPing = util.promisify(tcpp.ping);

let session = undefined;
let savedSession = undefined;

const userAgent = `react-native-update-cli/${packageJson.version}`;

exports.loadSession = async function () {
  if (fs.existsSync('.update')) {
    try {
      exports.replaceSession(JSON.parse(fs.readFileSync('.update', 'utf8')));
      savedSession = session;
    } catch (e) {
      console.error(
        'Failed to parse file `.update`. Try to remove it manually.',
      );
      throw e;
    }
  }
};

exports.getSession = function () {
  return session;
};

exports.replaceSession = function (newSession) {
  session = newSession;
};

exports.saveSession = function () {
  // Only save on change.
  if (session !== savedSession) {
    const current = session;
    const data = JSON.stringify(current, null, 4);
    fs.writeFileSync('.update', data, 'utf8');
    savedSession = current;
  }
};

exports.closeSession = function () {
  if (fs.existsSync('.update')) {
    fs.unlinkSync('.update');
    savedSession = undefined;
  }
  session = undefined;
  host = process.env.PUSHY_REGISTRY || defaultEndpoint;
};

async function query(url, options) {
  const resp = await fetch(url, options);
  const json = await resp.json();
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

exports.get = queryWithoutBody('GET');
exports.post = queryWithBody('POST');
exports.put = queryWithBody('PUT');
exports.doDelete = queryWithBody('DELETE');

async function uploadFile(fn, key) {
  const { url, backupUrl, formData, maxSize } = await exports.post('/upload', {
    ext: path.extname(fn),
  });
  let realUrl = url;

  if (backupUrl) {
    const pingResult = await tcpPing({
      address: url.replace('https://', ''),
      attempts: 4,
      timeout: 1000,
    });
    // console.log({pingResult});
    if (isNaN(pingResult.avg) || pingResult.avg > 150) {
      realUrl = backupUrl;
    }
    // console.log({realUrl});
  }

  const fileSize = fs.statSync(fn).size;
  if (maxSize && fileSize > filesizeParser(maxSize)) {
    throw new Error(
      `此文件大小${(fileSize / 1048576).toFixed(
        1,
      )}m, 超出当前额度${maxSize}。您可以考虑升级付费业务以提升此额度。详情请访问：${pricingPageUrl}`,
    );
  }

  const bar = new ProgressBar('  Uploading [:bar] :percent :etas', {
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
        headers: {
          'User-Agent': userAgent,
          'X-AccessToken': session ? session.token : '',
        },
      },
      (err, resp, body) => {
        if (err) {
          return reject(err);
        }
        if (resp.statusCode > 299) {
          return reject(
            Object.assign(new Error(body), { status: resp.statusCode }),
          );
        }
        resolve(
          body
            ? // qiniu
              JSON.parse(body)
            : // aliyun oss
              { hash: formData.key },
        );
      },
    );
  });
  return info;
}

exports.uploadFile = uploadFile;
