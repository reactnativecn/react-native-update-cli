const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * 计算文件的hash值
 * @param {string} filePath - 文件路径
 * @param {string} algorithm - 哈希算法 (默认: 'md5')
 * @returns {Promise<string>} - 返回文件的hash值
 */
function calculateFileHash(filePath, algorithm = 'md5') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath);

    stream.on('error', err => reject(err));
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export const commands = {
  hash: async function ({ args }) {
    const fn = args[0];
    const hash = await calculateFileHash(fn);
    console.log('文件hash值:', hash);
  },
};
