import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { CALL_COLUMNS } from '../../../src/core/validate';
import { createFileHandle } from '../../../src/db/handle';
import { createUploadService } from '../../../src/db/upload/service';
import { UploadFailed } from '../../../src/db/upload/types';
import { tempDir } from '../../server/helpers';
import { callLine } from '../helpers';
import { csvOf } from './helpers';

const CSV = csvOf(CALL_COLUMNS.join(','), [callLine({ call_id: 'c_secret' })]);

describe('upload service with a database file that cannot be opened', () => {
  const broken = (dir: string) => {
    const corrupt = join(dir, 'bad.db');
    writeFileSync(corrupt, 'not sqlite at all');
    return [corrupt, join(dir, 'missing.db')];
  };

  test('preview throws UploadFailed, keeping the reason', () => {
    const dir = tempDir();
    try {
      for (const path of broken(dir)) {
        const service = createUploadService(createFileHandle(path));
        let error: unknown;
        try {
          service.preview('calls.csv', CSV);
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(UploadFailed);
        const message = (error as Error).message;
        expect(message).toMatch(/^The upload could not be checked: /);
        expect(message).not.toContain('c_secret');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('commit throws UploadFailed saying nothing was stored', () => {
    const dir = tempDir();
    try {
      for (const path of broken(dir)) {
        const service = createUploadService(createFileHandle(path));
        expect(() => service.commit('calls.csv', CSV)).toThrow(UploadFailed);
        expect(() => service.commit('calls.csv', CSV)).toThrow(/nothing was stored/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
