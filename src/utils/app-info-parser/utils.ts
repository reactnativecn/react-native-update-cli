const objectType = (value: unknown): string =>
  Object.prototype.toString.call(value).slice(8, -1).toLowerCase();

const isArray = (value: unknown): value is unknown[] =>
  objectType(value) === 'array';

const isObject = (value: unknown): value is Record<string, unknown> =>
  objectType(value) === 'object';

const isPrimitive = (value: unknown): boolean =>
  value === null ||
  ['boolean', 'number', 'string', 'undefined'].includes(objectType(value));

const isBrowser = (): boolean =>
  typeof process === 'undefined' ||
  Object.prototype.toString.call(process) !== '[object process]';

/**
 * map file place with resourceMap
 * @param {Object} apkInfo // json info parsed from .apk file
 * @param {Object} resourceMap // resourceMap
 */
const mapInfoResource = (
  apkInfo: Record<string, any>,
  resourceMap: Record<string, any>,
) => {
  const iteratorObj = (obj: Record<string, any>) => {
    for (const i in obj) {
      if (isArray(obj[i])) {
        iteratorArray(obj[i] as any[]);
      } else if (isObject(obj[i])) {
        iteratorObj(obj[i] as Record<string, any>);
      } else if (isPrimitive(obj[i])) {
        if (isResources(obj[i])) {
          obj[i] = resourceMap[transKeyToMatchResourceMap(obj[i])];
        }
      }
    }
  };

  const iteratorArray = (array: any[]) => {
    const l = array.length;
    for (let i = 0; i < l; i++) {
      if (isArray(array[i])) {
        iteratorArray(array[i] as any[]);
      } else if (isObject(array[i])) {
        iteratorObj(array[i] as Record<string, any>);
      } else if (isPrimitive(array[i])) {
        if (isResources(array[i])) {
          array[i] = resourceMap[transKeyToMatchResourceMap(array[i])];
        }
      }
    }
  };

  const isResources = (attrValue: unknown) => {
    if (!attrValue) return false;
    const value =
      typeof attrValue === 'string' ? attrValue : attrValue.toString();
    return value.indexOf('resourceId:') === 0;
  };

  const transKeyToMatchResourceMap = (resourceId: string) =>
    `@${resourceId.replace('resourceId:0x', '').toUpperCase()}`;

  iteratorObj(apkInfo);
  return apkInfo;
};

/**
 * find .apk file's icon path from json info
 * @param info // json info parsed from .apk file
 */
const findApkIconPath = (info: any) => {
  if (!info.application.icon || !info.application.icon.splice) {
    return '';
  }
  const rulesMap: Record<string, number> = {
    mdpi: 48,
    hdpi: 72,
    xhdpi: 96,
    xxdpi: 144,
    xxxhdpi: 192,
  };
  const resultMap: Record<string, string> = {};
  const maxDpiIcon = { dpi: 120, icon: '' };

  for (const i in rulesMap) {
    info.application.icon.some((icon: string) => {
      if (icon && icon.indexOf(i) !== -1) {
        resultMap[`application-icon-${rulesMap[i]}`] = icon;
        return true;
      }
      return false;
    });

    if (
      resultMap[`application-icon-${rulesMap[i]}`] &&
      rulesMap[i] >= maxDpiIcon.dpi
    ) {
      maxDpiIcon.dpi = rulesMap[i];
      maxDpiIcon.icon = resultMap[`application-icon-${rulesMap[i]}`];
    }
  }

  if (Object.keys(resultMap).length === 0 || !maxDpiIcon.icon) {
    maxDpiIcon.dpi = 120;
    maxDpiIcon.icon = info.application.icon[0] || '';
    resultMap['applicataion-icon-120'] = maxDpiIcon.icon;
  }
  return maxDpiIcon.icon;
};

/**
 * find .ipa file's icon path from json info
 * @param info // json info parsed from .ipa file
 */
const findIpaIconPath = (info: any) => {
  if (info.CFBundleIcons?.CFBundlePrimaryIcon?.CFBundleIconFiles?.length) {
    return info.CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconFiles[
      info.CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconFiles.length - 1
    ];
  }
  if (info.CFBundleIconFiles?.length) {
    return info.CFBundleIconFiles[info.CFBundleIconFiles.length - 1];
  }
  return '.app/Icon.png';
};

/**
 * transform buffer to base64
 * @param {Buffer} buffer
 */
const getBase64FromBuffer = (buffer: Buffer | string) => {
  const base64 =
    typeof buffer === 'string' ? buffer : buffer.toString('base64');
  return `data:image/png;base64,${base64}`;
};

/**
 * 去除unicode空字符
 * @param {String} str
 */
const decodeNullUnicode = (value: string | RegExp) => {
  if (typeof value === 'string') {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: <explanation>
    return value.replace(/\u0000/g, '');
  }
  return value;
};

export {
  isArray,
  isObject,
  isPrimitive,
  isBrowser,
  mapInfoResource,
  findApkIconPath,
  findIpaIconPath,
  getBase64FromBuffer,
  decodeNullUnicode,
};
