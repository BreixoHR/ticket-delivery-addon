# Addon Tickets — Manual de instalación

Addon independiente de descarga de tickets/archivos, pensado para convivir en
el mismo servidor que una web (WordPress, Next.js, o cualquier otra) sin
tocar su código ni su base de datos. Clona automáticamente el header y el
footer de la web anfitriona para que la página `/ticket` tenga el mismo
diseño.

## Qué hace

- Recibe por webhook: `url` (descarga de Google Drive), `correo` y
  `localizador`, y los guarda en una tabla SQLite propia.
  - `localizador` es único: si llega uno repetido, se actualiza la URL de
    descarga de ese ticket (y se invalida su caché) en vez de crear uno nuevo.
  - `correo` sí admite duplicados.
- Sirve `https://<tu-web>/ticket`: formulario de correo + localizador.
- Sirve `https://<tu-web>/ticket/<localizador>`: enlace de descarga
  directa (sin pedir correo), pensado para enviarlo directamente al cliente.
- La URL de Google Drive **nunca** se expone al cliente ni aparece en logs:
  el fichero se descarga una vez en el servidor, se cachea en disco, y se
  sirve desde ahí en las siguientes descargas. Los ficheros cacheados se
  borran automáticamente pasado un tiempo configurable.

## Requisitos

- Node.js 18 o superior (recomendado 20+).
- npm.
- nginx o Apache ya sirviendo la web anfitriona (para añadir las rutas de
  proxy).
- Acceso `sudo` para crear el servicio systemd y recargar el webserver.

No requiere PHP, MySQL, ni ninguna dependencia del sitio en el que se instala.

## 1. Copiar el addon al servidor

Copia toda la carpeta `ADDON-TICKETS` a una ruta propia, por ejemplo:

```bash
/home/<usuario>/ADDON-TICKETS
```

## 2. Instalar dependencias

```bash
cd /home/<usuario>/ADDON-TICKETS
npm install
```

## 3. Configurar

```bash
cp .env.example .env
```

Edita `.env`:

- `PORT`: puerto interno (por defecto 3010). Si vas a instalar el addon para
  varias webs en el mismo servidor, cada instalación necesita su propio
  puerto (3010, 3011, 3012...).
- `BASE_PATH`: ruta pública del addon (por defecto `/ticket`). Cámbiala solo
  si esa ruta ya la usa la propia web anfitriona para otra cosa (por ejemplo,
  una tienda con productos reales en `/ticket/<algo>`); en ese caso elige
  otra ruta libre y compruébalo antes con `curl -I https://tu-web/<ruta-elegida>/algo-que-no-existe`
  (debe dar 404 de la propia web, no un contenido real).
- `TARGET_ORIGIN`: origen interno donde responde la web anfitriona
  (normalmente `http://127.0.0.1:<puerto de la web>`).
- `TARGET_HOST`: el dominio real de la web (el header `Host` que espera tu
  webserver/framework para servir el sitio correcto).
- `CHROME_REFRESH_MINUTES`, `CACHE_TTL_HOURS`, `CLAIM_TOKEN_TTL_MINUTES`:
  opcionales, valores por defecto razonables.
- `TOKEN_SECRET`: usa el **mismo valor en todas las instalaciones** (no uno
  distinto por sitio). El sistema que llama al webhook usa un único secreto
  para todos los dominios, así que copia aquí el mismo que ya tengan las
  demás instalaciones activas.

## 4. Arrancar como servicio (systemd)

Copia la plantilla y ajusta usuario/ruta si hace falta:

```bash
sudo cp deploy/addon-tickets.service.example /etc/systemd/system/AddonTickets.service
sudo nano /etc/systemd/system/AddonTickets.service   # revisa User= y WorkingDirectory=
sudo systemctl daemon-reload
sudo systemctl enable --now AddonTickets.service
sudo systemctl status AddonTickets.service
```

Deberías ver en el log: `addon-tickets escuchando en 127.0.0.1:<PORT>`.

## 5. Conectarlo a la web (nginx)

Abre el fichero de configuración de nginx de tu web (el `server { }` del
bloque HTTPS) y pega dentro los dos bloques de
`deploy/nginx-location-block.example.conf`, **antes** del `location /`
general que hace de catch-all.

Comprueba la sintaxis y recarga (nunca `restart`, para no cortar conexiones
activas):

```bash
sudo nginx -t
sudo systemctl reload nginx
```

> Si usas Apache en vez de nginx, el equivalente es un `ProxyPass` /
> `ProxyPassReverse` para `/ticket` y `/webhook/tickets` hacia
> `http://127.0.0.1:<PORT>`, con `mod_proxy` y `mod_proxy_http` activos.

## 6. Probar

```bash
# La web principal debe seguir funcionando igual
curl -I https://tu-dominio.com/

# El addon debe responder
curl https://tu-dominio.com/ticket/health

# Dar de alta un ticket de prueba
curl -X POST https://tu-dominio.com/webhook/tickets \
  -H 'Content-Type: application/json' \
  -H "X-Webhook-Secret: $(grep '^TOKEN_SECRET=' .env | cut -d= -f2-)" \
  -d '{"url":"https://drive.google.com/uc?export=download&id=TU_ID_DE_DRIVE","correo":"prueba@tu-dominio.com","localizador":"PRUEBA-1"}'

# Enlace directo
curl -I https://tu-dominio.com/ticket/PRUEBA-1
```

Abre en el navegador `https://tu-dominio.com/ticket` y comprueba que el
header/footer coinciden con los de la web.

## Formato del webhook

```json
POST /webhook/tickets
Content-Type: application/json
X-Webhook-Secret: <valor de TOKEN_SECRET en .env>

{
  "url": "https://drive.google.com/uc?export=download&id=XXXXX",
  "correo": "cliente@ejemplo.com",
  "localizador": "ABC-123"
}
```

La cabecera `X-Webhook-Secret` es obligatoria y debe coincidir exactamente con
`TOKEN_SECRET` del `.env` de esa instalación. Sin ella (o con un valor
incorrecto) el webhook responde `401` y no registra nada.

Respuestas:
- `201 { "ok": true }` — creado.
- `200 { "ok": true, "updated": true }` — el localizador ya existía: se actualizó
  la URL de descarga y se invalidó la caché (la próxima descarga trae el fichero nuevo).
- `401 { "error": "No autorizado" }` — falta la cabecera `X-Webhook-Secret` o no coincide.
- `400 { "error": "..." }` — faltan campos o la URL no es de Google Drive.

## Mover el addon a otra web

1. Copia la carpeta completa (o vuelve a clonarla) al nuevo servidor (o a
   otra ruta, si es una web más en el mismo servidor).
2. `npm install`.
3. Cambia en `.env`: `TARGET_ORIGIN`, `TARGET_HOST` y, si hace falta (varias
   instalaciones en el mismo servidor), `PORT` y `BASE_PATH`. **`TOKEN_SECRET`
   no se cambia**: copia el mismo valor que ya usan las demás instalaciones.
4. Repite el paso 4 (systemd, con un nombre de servicio distinto si ya hay
   otro en ese servidor) y el paso 5 (nginx) en el nuevo servidor.

No hay migraciones de base de datos ni pasos de "instalación" adicionales:
la tabla SQLite se crea sola en `data/tickets.db` al arrancar por primera vez.

## Mantenimiento

- **Logs**: `sudo journalctl -u AddonTickets -f`
- **Ver tickets guardados**: usa cualquier cliente SQLite sobre
  `data/tickets.db`, tabla `tickets`.
- **Caché de ficheros descargados**: carpeta `cache/`, se autolimpia según
  `CACHE_TTL_HOURS`.
- **Header/footer desactualizado**: se refresca solo cada
  `CHROME_REFRESH_MINUTES`; si cambias el tema de la web y quieres verlo ya,
  reinicia el servicio (`sudo systemctl restart AddonTickets`).

## Nota de seguridad

El enlace directo `/ticket/<localizador>` no pide correo: quien tenga ese
enlace puede descargar el archivo. Está pensado para enviarse por un canal
privado (email de confirmación, etc.). Si necesitas más control (caducidad,
límite de descargas), es una ampliación sencilla sobre `server.js`.
