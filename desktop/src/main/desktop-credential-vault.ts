import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface DesktopCredentialVault {
  get(reference: string): Promise<string | null>;
  put(reference: string, credential: string): Promise<void>;
  remove(reference: string): Promise<void>;
}

export interface StringCryptography {
  isAvailable(): Promise<boolean>;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<string>;
}

export class MemoryDesktopCredentialVault implements DesktopCredentialVault {
  readonly #credentials = new Map<string, string>();

  async get(reference: string): Promise<string | null> {
    return this.#credentials.get(reference) ?? null;
  }

  async put(reference: string, credential: string): Promise<void> {
    this.#credentials.set(reference, credential);
  }

  async remove(reference: string): Promise<void> {
    this.#credentials.delete(reference);
  }
}

export class EncryptedFileCredentialVault implements DesktopCredentialVault {
  constructor(
    private readonly filePath: string,
    private readonly cryptography: StringCryptography,
  ) {}

  async get(reference: string): Promise<string | null> {
    const values = await this.read();
    const encoded = values[reference];
    return encoded ? this.cryptography.decrypt(Buffer.from(encoded, 'base64')) : null;
  }

  async put(reference: string, credential: string): Promise<void> {
    await this.requireEncryption();
    const values = await this.read();
    values[reference] = (await this.cryptography.encrypt(credential)).toString('base64');
    await this.write(values);
  }

  async remove(reference: string): Promise<void> {
    const values = await this.read();
    delete values[reference];
    await this.write(values);
  }

  private async requireEncryption(): Promise<void> {
    if (!(await this.cryptography.isAvailable())) {
      throw new Error('Operating-system credential protection is unavailable.');
    }
  }

  private async read(): Promise<Record<string, string>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!isEncryptedMap(parsed)) throw new Error('Credential vault contains invalid data.');
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }

  private async write(values: Record<string, string>): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify(values), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.filePath);
  }
}

function isEncryptedMap(value: unknown): value is Record<string, string> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string');
}
