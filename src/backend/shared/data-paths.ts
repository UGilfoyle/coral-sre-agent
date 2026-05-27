import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** JSONL data directory for Coral sources (override with CORAL_DATA_DIR). */
export function getCoralDataDir(): string {
  if (process.env.CORAL_DATA_DIR) {
    return path.resolve(process.env.CORAL_DATA_DIR);
  }
  return path.join(__dirname, '..', 'data');
}

export function getCoralDataFile(filename: string): string {
  return path.join(getCoralDataDir(), filename);
}
