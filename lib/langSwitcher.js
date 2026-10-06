import { languageOptions } from './i18n.js';

export const LANG_SWITCH_MARKER = '<!--TK_LANG_SWITCH-->';

const SWITCHER_ATTR_PATTERNS = [
  /class\s*=\s*["'][^"']*\b(wpml-ls|lang-switcher|language-switcher|lang-select|language-select|lang_sel|langswitcher|polylang|trp-language-switcher|gtranslate|weglot|gt-selector|gt_selector)\b[^"']*["']/i,
  /id\s*=\s*["']([\w-]*wpml-ls[\w-]*|lang-switcher|language-switcher|[\w-]*lang_sel[\w-]*|langswitcher|polylang-switcher|trp-language-switcher|google_translate_element|gtranslate_wrapper|weglot-switcher|gt-selector|gt_selector)["']/i,
];

function findMatchingCloseTagEnd(html, openTagEnd, tagName) {
  const openRe = new RegExp(`<${tagName}(?=[\\s>])`, 'gi');
  const closeRe = new RegExp(`</${tagName}\\s*>`, 'gi');
  let depth = 1;
  let pos = openTagEnd;

  while (depth > 0) {
    openRe.lastIndex = pos;
    closeRe.lastIndex = pos;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) return -1;

    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      pos = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      pos = nextClose.index + nextClose[0].length;
    }
  }
  return pos;
}

function removeElementAt(html, openIndex, tagName) {
  const tagEnd = html.indexOf('>', openIndex);
  if (tagEnd === -1) return null;
  const closeEnd = findMatchingCloseTagEnd(html, tagEnd + 1, tagName);
  if (closeEnd === -1) return null;
  return { start: openIndex, end: closeEnd };
}

function findByKnownAttrPatterns(html) {
  const tagOpenRe = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let match;
  while ((match = tagOpenRe.exec(html))) {
    const [, tagName, attrs] = match;
    const isSwitcher = SWITCHER_ATTR_PATTERNS.some((pattern) => pattern.test(attrs));
    if (!isSwitcher) continue;
    const removed = removeElementAt(html, match.index, tagName);
    if (removed) return removed;
  }
  return null;
}

function findByHreflangCluster(html) {
  const hreflangRe = /\bhreflang\s*=\s*["'][a-zA-Z-]+["']/gi;
  const positions = [];
  let m;
  while ((m = hreflangRe.exec(html))) positions.push(m.index);
  if (positions.length < 2) return null;

  const first = positions[0];
  const last = positions[positions.length - 1];

  const containerOpenRe = /<(div|nav|ul|ol|span|li|p)\b[^>]*>/gi;
  let best = null;
  let cm;
  while ((cm = containerOpenRe.exec(html))) {
    if (cm.index > first) break;
    const tagName = cm[1];
    const tagEnd = cm.index + cm[0].length;
    const closeEnd = findMatchingCloseTagEnd(html, tagEnd, tagName);
    if (closeEnd !== -1 && closeEnd > last) {
      best = { start: cm.index, end: closeEnd };
    }
  }
  return best;
}

export function stripLanguageSwitcher(headerHtml) {
  const removed = findByKnownAttrPatterns(headerHtml) || findByHreflangCluster(headerHtml);
  if (removed) {
    return headerHtml.slice(0, removed.start) + LANG_SWITCH_MARKER + headerHtml.slice(removed.end);
  }

  const closeHeaderIdx = headerHtml.lastIndexOf('</header>');
  if (closeHeaderIdx !== -1) {
    return headerHtml.slice(0, closeHeaderIdx) + LANG_SWITCH_MARKER + headerHtml.slice(closeHeaderIdx);
  }
  const closeNavIdx = headerHtml.lastIndexOf('</nav>');
  if (closeNavIdx !== -1) {
    return headerHtml.slice(0, closeNavIdx) + LANG_SWITCH_MARKER + headerHtml.slice(closeNavIdx);
  }
  return headerHtml + LANG_SWITCH_MARKER;
}

export function buildLanguageSwitcherHtml(currentLang, hrefForLang) {
  const links = languageOptions()
    .map(({ code, name }) => {
      const cls = code === currentLang ? 'tk-lang-active' : '';
      return `<a href="${hrefForLang(code)}" class="tk-lang-link ${cls}">${name}</a>`;
    })
    .join('');
  return `<div class="tk-lang-switch">${links}</div>`;
}

export function renderHeaderWithSwitcher(headerHtml, currentLang, hrefForLang) {
  const switcherHtml = buildLanguageSwitcherHtml(currentLang, hrefForLang);
  if (headerHtml.includes(LANG_SWITCH_MARKER)) {
    return headerHtml.replace(LANG_SWITCH_MARKER, switcherHtml);
  }
  return headerHtml + switcherHtml;
}
