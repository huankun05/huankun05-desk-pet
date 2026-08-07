import type { PluginMetadata, PluginConfigSchema } from './types';

export interface PluginPackage {
  metadata: PluginMetadata;
  configSchema?: PluginConfigSchema;
  code: string;
}

export class PluginImporter {
  static async importFromZip(zipFile: File): Promise<PluginPackage | null> {
    try {
      const arrayBuffer = await zipFile.arrayBuffer();
      const zip = await this.parseZip(arrayBuffer);
      return this.extractPluginFromZip(zip);
    } catch {
      return null;
    }
  }

  static async importFromJson(jsonString: string): Promise<PluginPackage | null> {
    try {
      const data = JSON.parse(jsonString);
      if (!data.metadata || !data.code) {
        return null;
      }
      return {
        metadata: data.metadata as PluginMetadata,
        configSchema: data.configSchema as PluginConfigSchema | undefined,
        code: data.code as string,
      };
    } catch {
      return null;
    }
  }

  static async exportToJson(metadata: PluginMetadata, code: string): Promise<string> {
    const pkg: PluginPackage = {
      metadata,
      code,
    };
    return JSON.stringify(pkg, null, 2);
  }

  private static async parseZip(arrayBuffer: ArrayBuffer): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    const uint8Array = new Uint8Array(arrayBuffer);
    const textDecoder = new TextDecoder('utf-8');

    const zipHeader = uint8Array.slice(0, 4);
    if (
      zipHeader[0] !== 0x50 ||
      zipHeader[1] !== 0x4b ||
      zipHeader[2] !== 0x03 ||
      zipHeader[3] !== 0x04
    ) {
      throw new Error('Invalid zip file');
    }

    let offset = 0;
    while (offset < uint8Array.length) {
      if (
        uint8Array[offset] === 0x50 &&
        uint8Array[offset + 1] === 0x4b &&
        uint8Array[offset + 2] === 0x03 &&
        uint8Array[offset + 3] === 0x04
      ) {
        const fileNameLength = uint8Array[offset + 26] + (uint8Array[offset + 27] << 8);
        const extraFieldLength = uint8Array[offset + 28] + (uint8Array[offset + 29] << 8);
        const compressedSize =
          uint8Array[offset + 20] +
          (uint8Array[offset + 21] << 8) +
          (uint8Array[offset + 22] << 16) +
          (uint8Array[offset + 23] << 24);
        const uncompressedSize =
          uint8Array[offset + 16] +
          (uint8Array[offset + 17] << 8) +
          (uint8Array[offset + 18] << 16) +
          (uint8Array[offset + 19] << 24);

        const fileName = textDecoder.decode(
          uint8Array.slice(offset + 30, offset + 30 + fileNameLength),
        );

        const dataStart = offset + 30 + fileNameLength + extraFieldLength;
        const dataEnd = dataStart + compressedSize;

        if (uncompressedSize === compressedSize) {
          result[fileName] = textDecoder.decode(uint8Array.slice(dataStart, dataEnd));
        }

        offset = dataEnd;
      } else if (
        uint8Array[offset] === 0x50 &&
        uint8Array[offset + 1] === 0x4b &&
        uint8Array[offset + 2] === 0x01 &&
        uint8Array[offset + 3] === 0x02
      ) {
        break;
      } else {
        offset++;
      }
    }

    return result;
  }

  private static extractPluginFromZip(zipContents: Record<string, string>): PluginPackage | null {
    if (!zipContents['metadata.json']) {
      return null;
    }

    try {
      const metadata = JSON.parse(zipContents['metadata.json']) as PluginMetadata;
      const code = zipContents['main.js'] || zipContents['main.ts'] || '';
      const configSchema = zipContents['config.schema.json']
        ? (JSON.parse(zipContents['config.schema.json']) as PluginConfigSchema)
        : undefined;

      return {
        metadata: {
          ...metadata,
          isBuiltin: false,
          enabled: true,
        },
        configSchema,
        code,
      };
    } catch {
      return null;
    }
  }
}
