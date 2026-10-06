import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = path.join(__dirname, '..', 'cache');

export function cachePathForLocalizador(localizador) {
  const hash = crypto.createHash('sha256').update(localizador).digest('hex');
  return path.join(CACHE_DIR, hash + '.bin');
}

export function invalidateCacheForLocalizador(localizador) {
  const cachePath = cachePathForLocalizador(localizador);
  try {
    fs.unlinkSync(cachePath);
  } catch {}
  try {
    fs.unlinkSync(cachePath + '.meta.json');
  } catch {}
}

export function startCacheCleanupLoop() {
  const ttlHours = Number(process.env.CACHE_TTL_HOURS || 24);
  const sweep = () => {
    const cutoff = Date.now() - ttlHours * 60 * 60 * 1000;
    let entries;
    try {
      entries = fs.readdirSync(CACHE_DIR);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.bin')) continue;
      const full = path.join(CACHE_DIR, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(full);
          const meta = full + '.meta.json';
          if (fs.existsSync(meta)) fs.unlinkSync(meta);
          console.log('[cache] purgado por antiguedad:', entry);
        }
      } catch {
      }
    }
  };
  sweep();
  setInterval(sweep, 30 * 60 * 1000);
}
