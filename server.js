import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import crypto from 'crypto';
import { insertTicket, updateTicketUrl, findTicket, findTicketById, findTicketByLocalizador } from './lib/db.js';
import { getChrome, startChromeRefreshLoop } from './lib/chrome.js';
import { downloadDriveFile } from './lib/drive.js';
import { cachePathForLocalizador, invalidateCacheForLocalizador, startCacheCleanupLoop } from './lib/cache.js';
import { resolveLang, t } from './lib/i18n.js';
import { renderHeaderWithSwitcher } from './lib/langSwitcher.js';

const PORT = Number(process.env.PORT || 3010);
const CLAIM_TTL_MS = Number(process.env.CLAIM_TOKEN_TTL_MINUTES || 10) * 60 * 1000;
const BASE_PATH = (process.env.BASE_PATH || '/ticket').replace(/\/+$/, '') || '/ticket';

// Integración opcional con un formulario de soporte de HubSpot (vacío = desactivada)
const HUBSPOT_PORTAL_ID = process.env.HUBSPOT_PORTAL_ID || '';
const HUBSPOT_FORM_ID = process.env.HUBSPOT_FORM_ID || '';
const HUBSPOT_REGION = process.env.HUBSPOT_REGION || 'eu1';
const HUBSPOT_LOCALIZADOR_FIELD = process.env.HUBSPOT_LOCALIZADOR_FIELD || 'localizador';
const HUBSPOT_ENABLED = Boolean(HUBSPOT_PORTAL_ID && HUBSPOT_FORM_ID);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));

const claimTokens = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of claimTokens) {
    if (data.expiresAt < now) claimTokens.delete(token);
  }
}, 60 * 1000);

function maskForLog(obj) {
  const clone = { ...obj };
  if (clone.url || clone.drive_url || clone.url_drive) clone.url = clone.drive_url = clone.url_drive = '[oculta]';
  return clone;
}

function isGoogleDriveUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const { hostname, protocol } = new URL(value);
    if (protocol !== 'https:') return false;
    return hostname === 'drive.google.com' || hostname.endsWith('.drive.google.com');
  } catch {
    return false;
  }
}

function isValidWebhookSecret(provided) {
  const expected = process.env.TOKEN_SECRET;
  if (!expected || typeof provided !== 'string') return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

const PAGE_STYLE = `
  .tk-wrap{max-width:440px;margin:4rem auto;padding:2.2rem;border-radius:14px;
    background:rgba(127,127,127,0.08);}
  .tk-wrap h1{margin-top:0;font-size:1.4rem;}
  .tk-wrap label{display:block;font-size:.85rem;margin:.8rem 0 .3rem;opacity:.8;}
  .tk-wrap input{display:block;width:100%;box-sizing:border-box;padding:.6rem .8rem;
    border-radius:8px;border:1px solid rgba(127,127,127,0.4);font-size:1rem;}
  .tk-wrap button{margin-top:1.2rem;padding:.7rem 1.4rem;border-radius:8px;border:none;
    cursor:pointer;background:#111;color:#fff;font-size:1rem;}
  .tk-wrap button:disabled{opacity:.6;cursor:default;}
  .tk-msg{margin-top:1rem;font-size:.9rem;min-height:1.2em;font-weight:600;}
  .tk-msg-success{color:#1e8449;}
  .tk-msg-error{color:#c0392b;}
  .tk-lang-switch{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;font-size:.85rem;}
  .tk-lang-link{opacity:.7;text-decoration:none;}
  .tk-lang-link.tk-lang-active{opacity:1;font-weight:600;text-decoration:underline;}
  .tk-aviso{--tk-ink:#161616;--tk-slate:#2c3338;--tk-muted:#5b6670;--tk-dark:#171717;
    --tk-dark-hover:#2c3338;--tk-accent:#1b7f4b;--tk-accent-soft:rgba(27,127,75,0.10);
    --tk-soft-bg:#f6f6f4;--tk-soft-border:#e5e5e1;display:flex;align-items:center;
    justify-content:center;text-align:center;font-family:"Montserrat","Helvetica Neue",Arial,sans-serif;
    padding:clamp(40px,6vw,80px) clamp(20px,5vw,48px);box-sizing:border-box;}
  .tk-aviso *{box-sizing:border-box;}
  .tk-aviso__inner{max-width:560px;width:100%;}
  .tk-aviso__icon{display:inline-flex;align-items:center;justify-content:center;width:76px;
    height:76px;border-radius:50%;background:var(--tk-accent-soft);color:var(--tk-accent);
    margin-bottom:clamp(18px,2.5vw,24px);animation:tk-aviso-pulse 2.8s ease-in-out infinite;}
  @keyframes tk-aviso-pulse{0%,100%{transform:scale(1);}50%{transform:scale(1.05);}}
  @media (prefers-reduced-motion: reduce){.tk-aviso__icon,.tk-aviso__status-dots span{animation:none;}}
  .tk-aviso__title{font-family:"Poppins","Helvetica Neue",Arial,sans-serif;
    font-size:clamp(28px,5vw,44px);font-weight:600;line-height:1.18;color:var(--tk-ink);
    margin:0 0 clamp(12px,2vw,16px);}
  .tk-aviso__status{display:inline-flex;align-items:center;gap:6px;font-size:14px;
    font-weight:600;letter-spacing:0.01em;color:var(--tk-slate);margin-bottom:clamp(20px,3vw,28px);}
  .tk-aviso__status-dots{display:inline-flex;gap:4px;}
  .tk-aviso__status-dots span{width:6px;height:6px;border-radius:50%;background:var(--tk-accent);
    animation:tk-aviso-dots 1.4s ease-in-out infinite;}
  .tk-aviso__status-dots span:nth-child(2){animation-delay:0.2s;}
  .tk-aviso__status-dots span:nth-child(3){animation-delay:0.4s;}
  @keyframes tk-aviso-dots{0%,100%{opacity:0.3;}50%{opacity:1;}}
  .tk-aviso__lead{font-size:clamp(17px,2.6vw,21px);line-height:1.6;color:var(--tk-muted);
    margin:0 auto clamp(24px,4vw,32px);max-width:46ch;}
  .tk-aviso__box{background:var(--tk-soft-bg);border:1px solid var(--tk-soft-border);
    border-left:4px solid var(--tk-accent);border-radius:4px;
    padding:clamp(18px,3vw,24px) clamp(20px,3.5vw,28px);margin:0 auto clamp(16px,3vw,20px);
    max-width:48ch;text-align:left;}
  .tk-aviso__box p{margin:0;font-size:clamp(15px,2.3vw,18px);line-height:1.65;color:var(--tk-ink);}
  .tk-aviso__box strong{color:var(--tk-slate);font-weight:600;}
  .tk-aviso__btn{margin-top:clamp(12px,2vw,18px);display:inline-flex;align-items:center;
    gap:10px;padding:15px 30px;font-family:"Montserrat","Helvetica Neue",Arial,sans-serif;
    font-size:clamp(16px,2vw,18px);font-weight:600;text-decoration:none;color:#fff;
    background:var(--tk-dark);border:1px solid var(--tk-dark);border-radius:4px;
    transition:background 0.2s ease, border-color 0.2s ease;}
  .tk-aviso__btn:hover,.tk-aviso__btn:focus{background:var(--tk-dark-hover);
    border-color:var(--tk-dark-hover);color:#fff;}
  .tk-aviso__btn-icon{transition:transform 0.2s ease;}
  .tk-aviso__btn:hover .tk-aviso__btn-icon,.tk-aviso__btn:focus .tk-aviso__btn-icon{
    transform:translateX(4px);}
  .tk-aviso__help{font-size:14px;line-height:1.6;color:var(--tk-muted);
    margin:clamp(26px,4vw,34px) auto 0;max-width:44ch;}
  .tk-aviso__help a,.tk-aviso__form-link{color:var(--tk-slate);text-decoration:underline;
    text-underline-offset:2px;cursor:pointer;}
  .tk-aviso__help a:hover,.tk-aviso__help a:focus,.tk-aviso__form-link:hover,
    .tk-aviso__form-link:focus{color:var(--tk-ink);}
  .tk-aviso__collapse{max-height:0;overflow:hidden;transition:max-height 0.35s ease;}
  .tk-aviso__toggle:checked ~ .tk-aviso__collapse{max-height:1000px;}
  .tk-aviso__collapse-inner{margin:clamp(16px,3vw,22px) auto 0;max-width:48ch;
    padding:clamp(22px,4vw,32px);background:var(--tk-soft-bg);
    border:1px dashed var(--tk-soft-border);border-radius:4px;color:var(--tk-muted);
    font-size:15px;text-align:center;}
`;

function langHref(req, code) {
  const params = new URLSearchParams(req.query);
  params.set('lang', code);
  return `${req.path}?${params.toString()}`;
}

function renderShell(lang, chrome, bodyHtml, extraScript, req) {
  const headerHtml = renderHeaderWithSwitcher(chrome.headerHtml, lang, (code) => langHref(req, code));
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t(lang, 'pageTitle')}</title>
${chrome.iconLinks}
${chrome.stylesheetLinks}
<style>${PAGE_STYLE}</style>
${HUBSPOT_ENABLED ? `<script type="text/javascript" id="hs-script-loader" async defer src="//js-${HUBSPOT_REGION}.hs-scripts.com/${HUBSPOT_PORTAL_ID}.js"></script>` : ''}
</head>
<body>
${headerHtml}
<main style="min-height:55vh;">
${bodyHtml}
</main>
${chrome.footerHtml}
${extraScript || ''}
</body>
</html>`;
}

function renderNoticePage(lang, chrome, req) {
  const body = `  <div class="tk-aviso">
    <div class="tk-aviso__inner">

      <div class="tk-aviso__icon" aria-hidden="true">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6 2h12M6 22h12M8 2v4a4 4 0 0 0 4 4 4 4 0 0 0 4-4V2M8 22v-4a4 4 0 0 1 4-4 4 4 0 0 1 4 4v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>

      <h1 class="tk-aviso__title">${t(lang, 'preparingTitle')}</h1>

      <span class="tk-aviso__status">
        ${t(lang, 'preparingStatus')}
        <span class="tk-aviso__status-dots" aria-hidden="true">
          <span></span><span></span><span></span>
        </span>
      </span>

      <p class="tk-aviso__lead">${t(lang, 'preparingLead')}</p>

      <div class="tk-aviso__box">
        <p>${t(lang, 'preparingBox')}</p>
      </div>

      <a class="tk-aviso__btn" href="/">
        ${t(lang, 'preparingButton')}
        <svg class="tk-aviso__btn-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </a>

      ${HUBSPOT_ENABLED ? `
      <input type="checkbox" id="tk-form-toggle" class="tk-aviso__toggle" hidden>

      <p class="tk-aviso__help">
        ${t(lang, 'preparingHelpPre')} <label for="tk-form-toggle" class="tk-aviso__form-link">${t(lang, 'preparingHelpLink')}</label>${t(lang, 'preparingHelpEnd')}
      </p>

      <div class="tk-aviso__collapse">
        <div class="tk-aviso__collapse-inner">
          <div class="hs-form-frame" data-region="${HUBSPOT_REGION}" data-form-id="${HUBSPOT_FORM_ID}" data-portal-id="${HUBSPOT_PORTAL_ID}"></div>
        </div>
      </div>` : ''}

    </div>
  </div>`;
  const script = HUBSPOT_ENABLED
    ? `<script src="https://js-${HUBSPOT_REGION}.hsforms.net/forms/embed/${HUBSPOT_PORTAL_ID}.js" defer></script>`
    : '';
  return renderShell(lang, chrome, body, script, req);
}

function redirectWithLocalizador(req, res, localizador) {
  if (!HUBSPOT_ENABLED || req.query[HUBSPOT_LOCALIZADOR_FIELD]) return false;
  const sep = req.originalUrl.includes('?') ? '&' : '?';
  res.redirect(`${req.originalUrl}${sep}${HUBSPOT_LOCALIZADOR_FIELD}=${encodeURIComponent(localizador)}`);
  return true;
}

async function serveTicketFile(ticket, res, lang, req) {
  const cachePath = cachePathForLocalizador(ticket.localizador);
  const metaPath = cachePath + '.meta.json';

  try {
    if (!fs.existsSync(cachePath)) {
      console.log('[download] cache miss, descargando fichero de origen para ticket id', ticket.id);
      await downloadDriveFile(ticket.drive_url, cachePath);
    }

    let filename = 'ticket.bin';
    if (fs.existsSync(metaPath)) {
      try {
        filename = JSON.parse(fs.readFileSync(metaPath, 'utf8')).filename || filename;
      } catch {
      }
    }

    res.set('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
    res.set('Content-Type', 'application/octet-stream');
    fs.createReadStream(cachePath).pipe(res);
  } catch (err) {
    console.error('[download] fallo preparando descarga para ticket id', ticket.id, '-', err.message);
    if (req && redirectWithLocalizador(req, res, ticket.localizador)) return;
    res.status(502).set('Content-Type', 'text/html; charset=utf-8')
      .send(renderNoticePage(lang, getChrome(), req));
  }
}

app.post('/webhook/tickets', (req, res) => {
  if (!isValidWebhookSecret(req.get('X-Webhook-Secret'))) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const body = req.body || {};
  const driveUrl = body.url || body.drive_url || body.url_drive;
  const email = body.correo || body.email;
  const localizador = body.localizador;

  if (!driveUrl || !email || !localizador) {
    return res.status(400).json({ error: 'Faltan campos: url, correo, localizador son obligatorios' });
  }
  if (!isGoogleDriveUrl(driveUrl)) {
    return res.status(400).json({ error: 'url debe ser un enlace https de drive.google.com' });
  }

  try {
    const existing = findTicketByLocalizador(String(localizador));
    if (existing) {
      updateTicketUrl({ driveUrl, localizador: String(localizador) });
      invalidateCacheForLocalizador(String(localizador));
      console.log('[webhook] ticket actualizado:', maskForLog({ email, localizador }));
      return res.status(200).json({ ok: true, updated: true });
    }

    insertTicket({ driveUrl, email: String(email), localizador: String(localizador) });
    console.log('[webhook] nuevo ticket registrado:', maskForLog({ email, localizador }));
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error('[webhook] error inesperado:', err.message);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.get(BASE_PATH, (req, res) => {
  const chrome = getChrome();
  const lang = resolveLang(req.query.lang);
  const body = `  <div class="tk-wrap">
    <h1>${t(lang, 'heading')}</h1>
    <p>${t(lang, 'description')}</p>
    <form id="tkForm">
      <label for="tkEmail">${t(lang, 'labelEmail')}</label>
      <input id="tkEmail" name="email" type="email" required>
      <label for="tkLoc">${t(lang, 'labelLocalizador')}</label>
      <input id="tkLoc" name="localizador" type="text" required>
      <button type="submit" id="tkBtn">${t(lang, 'buttonSubmit')}</button>
    </form>
    <div class="tk-msg" id="tkMsg"></div>
  </div>`;
  const script = `<script>
  var TK_LANG = ${JSON.stringify(lang)};
  var TK_BASE = ${JSON.stringify(BASE_PATH)};
  var TK_MSG = {
    searching: ${JSON.stringify(t(lang, 'jsSearching'))},
    notFound: ${JSON.stringify(t(lang, 'errNotFoundClaim'))},
    foundPreparing: ${JSON.stringify(t(lang, 'jsFoundPreparing'))},
    retryHint: ${JSON.stringify(t(lang, 'jsRetryHint'))},
    connectionError: ${JSON.stringify(t(lang, 'jsConnectionError'))}
  };
  function setMsg(text, tone) {
    var msg = document.getElementById('tkMsg');
    msg.textContent = text;
    msg.className = 'tk-msg' + (tone ? ' tk-msg-' + tone : '');
  }
  document.getElementById('tkForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var btn = document.getElementById('tkBtn');
    var email = document.getElementById('tkEmail').value.trim();
    var localizador = document.getElementById('tkLoc').value.trim();
    btn.disabled = true;
    setMsg(TK_MSG.searching, null);
    try {
      var r = await fetch(TK_BASE + '/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, localizador: localizador, lang: TK_LANG })
      });
      var data = await r.json();
      if (!r.ok) {
        setMsg(data.error || TK_MSG.notFound, 'error');
        btn.disabled = false;
        return;
      }
      setMsg(TK_MSG.foundPreparing, 'success');
      window.location.href = TK_BASE + '/download/' + data.token + '?lang=' + TK_LANG;
      setTimeout(function () { btn.disabled = false; setMsg(TK_MSG.retryHint, 'success'); }, 4000);
    } catch (err) {
      setMsg(TK_MSG.connectionError, 'error');
      btn.disabled = false;
    }
  });
</script>`;
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(renderShell(lang, chrome, body, script, req));
});

app.post(`${BASE_PATH}/claim`, (req, res) => {
  const { email, localizador, lang } = req.body || {};
  const resolvedLang = resolveLang(lang);
  if (!email || !localizador) {
    return res.status(400).json({ error: t(resolvedLang, 'errMissingFields') });
  }

  const ticket = findTicket({ email: String(email), localizador: String(localizador) });
  if (!ticket) {
    return res.status(404).json({ error: t(resolvedLang, 'errNotFoundClaim') });
  }

  const token = crypto.randomBytes(24).toString('hex');
  claimTokens.set(token, { ticketId: ticket.id, expiresAt: Date.now() + CLAIM_TTL_MS });
  return res.json({ token });
});

app.get(`${BASE_PATH}/download/:token`, async (req, res) => {
  const lang = resolveLang(req.query.lang);
  const chrome = getChrome();
  const entry = claimTokens.get(req.params.token);
  if (!entry || entry.expiresAt < Date.now()) {
    return res.status(410).set('Content-Type', 'text/html; charset=utf-8')
      .send(renderNoticePage(lang, chrome, req));
  }
  claimTokens.delete(req.params.token);

  const ticket = findTicketById(entry.ticketId);
  if (!ticket) {
    return res.status(404).set('Content-Type', 'text/html; charset=utf-8')
      .send(renderNoticePage(lang, chrome, req));
  }

  await serveTicketFile(ticket, res, lang, req);
});

app.get(`${BASE_PATH}/health`, (req, res) => {
  const chrome = getChrome();
  res.json({ ok: true, chromeFetchedAt: chrome.fetchedAt });
});

app.get(`${BASE_PATH}/:localizador`, async (req, res) => {
  const lang = resolveLang(req.query.lang);
  const ticket = findTicketByLocalizador(req.params.localizador);
  if (!ticket) {
    if (redirectWithLocalizador(req, res, req.params.localizador)) return;
    return res.status(404).set('Content-Type', 'text/html; charset=utf-8')
      .send(renderNoticePage(lang, getChrome(), req));
  }
  await serveTicketFile(ticket, res, lang, req);
});

startChromeRefreshLoop();
startCacheCleanupLoop();

app.listen(PORT, '127.0.0.1', () => {
  console.log(`addon-tickets escuchando en 127.0.0.1:${PORT}`);
});
