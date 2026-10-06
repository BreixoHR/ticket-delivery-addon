import { stripLanguageSwitcher, LANG_SWITCH_MARKER } from './langSwitcher.js';

const TARGET_ORIGIN = process.env.TARGET_ORIGIN || 'http://127.0.0.1:3000';
const TARGET_HOST = process.env.TARGET_HOST || 'localhost';

let cached = {
  headerHtml: `<header>${LANG_SWITCH_MARKER}</header>`,
  footerHtml: '<footer></footer>',
  stylesheetLinks: '',
  iconLinks: '',
  fetchedAt: 0,
};

function extractHeader(html) {
  const headerOpen = html.indexOf('<header');
  if (headerOpen !== -1) {
    const headerClose = html.indexOf('</header>', headerOpen);
    if (headerClose !== -1) {
      return html.slice(headerOpen, headerClose + '</header>'.length);
    }
  }
  const navOpen = html.indexOf('<nav');
  if (navOpen !== -1) {
    const navClose = html.indexOf('</nav>', navOpen);
    if (navClose !== -1) {
      return html.slice(navOpen, navClose + '</nav>'.length);
    }
  }
  return null;
}

function extractFooter(html) {
  const footerOpen = html.lastIndexOf('<footer');
  if (footerOpen === -1) return null;
  const footerClose = html.indexOf('</footer>', footerOpen);
  if (footerClose === -1) return null;
  return html.slice(footerOpen, footerClose + '</footer>'.length);
}

function extractStylesheets(html) {
  const links = html.match(/<link[^>]+rel=["']stylesheet["'][^>]*>/g) || [];
  return links.join('\n');
}

function extractIcons(html) {
  const links = html.match(/<link[^>]+rel=["'](?:shortcut icon|icon|apple-touch-icon(?:-precomposed)?|mask-icon)["'][^>]*>/gi) || [];
  return links.join('\n');
}

export async function refreshChrome() {
  const res = await fetch(TARGET_ORIGIN + '/', {
    headers: { Host: TARGET_HOST },
  });
  if (!res.ok) throw new Error('No se pudo leer la home del sitio anfitrion');
  const html = await res.text();

  const rawHeaderHtml = extractHeader(html);
  const footerHtml = extractFooter(html);
  const stylesheetLinks = extractStylesheets(html);
  const iconLinks = extractIcons(html);

  if (!rawHeaderHtml || !footerHtml) {
    throw new Error('No se han encontrado header/footer en el HTML del sitio');
  }

  const headerHtml = stripLanguageSwitcher(rawHeaderHtml);

  cached = { headerHtml, footerHtml, stylesheetLinks, iconLinks, fetchedAt: Date.now() };
  return cached;
}

export function getChrome() {
  return cached;
}

export function startChromeRefreshLoop() {
  const minutes = Number(process.env.CHROME_REFRESH_MINUTES || 60);
  const tick = () =>
    refreshChrome().catch((err) => {
      console.error('[chrome] fallo al refrescar header/footer, se mantiene el cacheado anterior:', err.message);
    });
  tick();
  setInterval(tick, minutes * 60 * 1000);
}
