import { Zip } from './zip';

export class AppParser extends Zip {
  async parse(): Promise<Record<string, never>> {
    return {};
  }
}
