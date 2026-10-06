import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';

const UA = 'Mozilla/5.0 (compatible; TicketAddon/1.0)';

function extractDriveId(url) {
  const m1 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];
  const m2 = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m2) return m2[1];
  return null;
}

function parseCookies(setCookieHeader, jar) {
  if (!setCookieHeader) return;
  setCookieHeader.split(/,(?=[^;]+=[^;]+)/).forEach((c) => {
    const [pair] = c.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) {
      jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  });
}

async function fetchWithCookies(url, jar) {
  const cookieHeader = Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
    redirect: 'follow',
  });
  parseCookies(res.headers.get('set-cookie'), jar);
  return res;
}

function safeErrorMessage() {
  return new Error('No se ha podido preparar la descarga');
}

export async function downloadDriveFile(driveUrl, destPath) {
  const id = extractDriveId(driveUrl);
  const directUrl = id
    ? `https://drive.google.com/uc?export=download&id=${id}`
    : driveUrl;

  const jar = {};
  let res;
  try {
    res = await fetchWithCookies(directUrl, jar);
  } catch {
    throw safeErrorMessage();
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/html')) {
    const text = await res.text();
    const confirmMatch = text.match(/confirm=([0-9A-Za-z_-]+)/);
    if (confirmMatch && id) {
      const confirmUrl = `https://drive.google.com/uc?export=download&confirm=${confirmMatch[1]}&id=${id}`;
      try {
        res = await fetchWithCookies(confirmUrl, jar);
      } catch {
        throw safeErrorMessage();
      }
    } else {
      throw safeErrorMessage();
    }
  }

  if (!res.ok || !res.body) throw safeErrorMessage();

  const dispo = res.headers.get('content-disposition') || '';
  const nameMatch = dispo.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/);
  const filename = nameMatch ? decodeURIComponent(nameMatch[1]) : 'archivo.bin';

  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  const tmpPath = destPath + '.part';
  await new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(tmpPath);
    Readable.fromWeb(res.body).pipe(fileStream);
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
  });
  await fs.promises.rename(tmpPath, destPath);

  await fs.promises.writeFile(
    destPath + '.meta.json',
    JSON.stringify({ filename, cachedAt: Date.now() })
  );

  return { filename };
}
