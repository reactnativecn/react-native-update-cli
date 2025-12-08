const Zip = require('./zip');
const path = require('path');
const protobuf = require('protobufjs');
const {
  mapInfoResource,
  findApkIconPath,
  getBase64FromBuffer,
} = require('./utils');
const ManifestName = /^androidmanifest\.xml$/;
const ResourceName = /^resources\.arsc$/;
const ResourceProtoName = /^resources\.pb$/;

const ManifestXmlParser = require('./xml-parser/manifest');
const ResourceFinder = require('./resource-finder');

class ApkParser extends Zip {
  /**
   * parser for parsing .apk file
   * @param {String | File | Blob} file // file's path in Node, instance of File or Blob in Browser
   */
  constructor(file) {
    super(file);
    if (!(this instanceof ApkParser)) {
      return new ApkParser(file);
    }
  }
  parse() {
    return new Promise((resolve, reject) => {
      this.getEntries([ManifestName, ResourceName, ResourceProtoName])
        .then((buffers) => {
          const manifestBuffer = buffers[ManifestName];
          if (!manifestBuffer) {
            throw new Error("AndroidManifest.xml can't be found.");
          }
          let apkInfo;
          let resourceMap;

          try {
            apkInfo = this._parseManifest(manifestBuffer);
          } catch (e) {
            // 尝试解析 proto manifest（来自 AAB）
            apkInfo = this._parseProtoManifest(
              manifestBuffer,
              buffers[ResourceProtoName],
            );
          }
          if (!buffers[ResourceName]) {
            resolve(apkInfo);
          } else {
            // parse resourceMap
            resourceMap = this._parseResourceMap(buffers[ResourceName]);
            // update apkInfo with resourceMap
            apkInfo = mapInfoResource(apkInfo, resourceMap);

            // find icon path and parse icon
            const iconPath = findApkIconPath(apkInfo);
            if (iconPath) {
              this.getEntry(iconPath)
                .then((iconBuffer) => {
                  apkInfo.icon = iconBuffer
                    ? getBase64FromBuffer(iconBuffer)
                    : null;
                  resolve(apkInfo);
                })
                .catch((e) => {
                  apkInfo.icon = null;
                  resolve(apkInfo);
                  console.warn('[Warning] failed to parse icon: ', e);
                });
            } else {
              apkInfo.icon = null;
              resolve(apkInfo);
            }
          }
        })
        .catch((e) => {
          reject(e);
        });
    });
  }
  /**
   * Parse manifest
   * @param {Buffer} buffer // manifest file's buffer
   */
  _parseManifest(buffer) {
    try {
      const parser = new ManifestXmlParser(buffer, {
        ignore: [
          'application.activity',
          'application.service',
          'application.receiver',
          'application.provider',
          'permission-group',
        ],
      });
      return parser.parse();
    } catch (e) {
      throw new Error('Parse AndroidManifest.xml error: ' + (e.message || e));
    }
  }
  /**
   * Parse resourceMap
   * @param {Buffer} buffer // resourceMap file's buffer
   */
  _parseResourceMap(buffer) {
    try {
      return new ResourceFinder().processResourceTable(buffer);
    } catch (e) {
      throw new Error('Parser resources.arsc error: ' + e);
    }
  }

  _parseProtoManifest(buffer, resourceProtoBuffer) {
    const rootPath = path.resolve(__dirname, '../../../proto/Resources.proto');
    const root = protobuf.loadSync(rootPath);
    const XmlNode = root.lookupType('aapt.pb.XmlNode');
    const manifest = XmlNode.toObject(XmlNode.decode(buffer), {
      enums: String,
      longs: Number,
      bytes: Buffer,
      defaults: true,
      arrays: true,
    }).element;

    if (!manifest || manifest.name !== 'manifest') {
      throw new Error('Invalid proto manifest');
    }

    const apkInfo = Object.create(null);
    apkInfo.application = { metaData: [] };

    for (const attr of manifest.attribute || []) {
      if (attr.name === 'versionName') {
        apkInfo.versionName = this._resolveProtoValue(
          attr,
          resourceProtoBuffer,
          root,
        );
      } else if (attr.name === 'versionCode') {
        apkInfo.versionCode = this._resolveProtoValue(
          attr,
          resourceProtoBuffer,
          root,
        );
      } else if (attr.name === 'package') {
        apkInfo.package = attr.value;
      }
    }

    const applicationNode = (manifest.child || []).find(
      (c) => c.element && c.element.name === 'application',
    );
    if (applicationNode?.element?.child) {
      const metaDataNodes = applicationNode.element.child.filter(
        (c) => c.element && c.element.name === 'meta-data',
      );
      for (const meta of metaDataNodes) {
        let name = '';
        let value;
        for (const attr of meta.element.attribute || []) {
          if (attr.name === 'name') {
            name = attr.value;
          } else if (attr.name === 'value') {
            value = this._resolveProtoValue(
              attr,
              resourceProtoBuffer,
              root,
            );
          }
        }
        if (name) {
          apkInfo.application.metaData.push({
            name,
            value: Array.isArray(value) ? value : [value],
          });
        }
      }
    }
    return apkInfo;
  }

  _resolveProtoValue(attr, resourceProtoBuffer, root) {
    if (!attr) return null;
    const refId = attr.compiledItem?.ref?.id;
    if (refId && resourceProtoBuffer) {
      const resolved = this._resolveResourceFromProto(
        resourceProtoBuffer,
        refId,
        root,
      );
      if (resolved !== null) {
        return resolved;
      }
    }
    const prim = attr.compiledItem?.prim;
    if (prim?.intDecimalValue !== undefined) {
      return prim.intDecimalValue.toString();
    }
    if (prim?.stringValue) {
      return prim.stringValue;
    }
    if (attr.value !== undefined && attr.value !== null) {
      return attr.value;
    }
    return null;
  }

  _resolveResourceFromProto(resourceBuffer, resourceId, root) {
    try {
      const ResourceTable = root.lookupType('aapt.pb.ResourceTable');
      const table = ResourceTable.toObject(ResourceTable.decode(resourceBuffer), {
        enums: String,
        longs: Number,
        bytes: Buffer,
        defaults: true,
        arrays: true,
      });

      const pkgId = (resourceId >> 24) & 0xff;
      const typeId = (resourceId >> 16) & 0xff;
      const entryId = resourceId & 0xffff;

      const pkg = (table.package || []).find((p) => p.packageId === pkgId);
      if (!pkg) return null;

      const type = (pkg.type || []).find((t) => t.typeId === typeId);
      if (!type) return null;

      const entry = (type.entry || []).find((e) => e.entryId === entryId);
      if (!entry || !entry.configValue?.length) return null;

      const val = entry.configValue[0].value;
      if (val.item?.str) {
        return val.item.str.value;
      }
      if (val.item?.prim?.intDecimalValue !== undefined) {
        return val.item.prim.intDecimalValue.toString();
      }
      return null;
    } catch (e) {
      return null;
    }
  }
}

module.exports = ApkParser;
