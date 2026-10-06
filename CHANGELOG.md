# Historial de versiones

## 1.2.0 · 2026-10-05: versión pública
- Sin IDs ni marcas en el código: HubSpot pasa a ser opcional y se configura por `.env`.
- Tests de integración (`node:test`) y CI en Node 22/24.
- Requiere Node 22+ (`better-sqlite3` 13).

## 1.2 · 2026-09-24
- Internacionalización en 7 idiomas y **sustitución del selector de idioma** de la web anfitriona (WPML, Polylang, TranslatePress, GTranslate, Weglot…).
- Página de aviso con formulario de soporte cuando las entradas aún no están listas.
- Desplegado en 3 webs del mismo servidor, con copias de seguridad previas de WordPress, base de datos y nginx.

## 1.1.0 · 2026-09-23
- Tokens de descarga de un solo uso con caducidad.
- El webhook se valida con un secreto compartido mediante comparación en tiempo constante.

## 1.0.0 · 2026-09-13
- Primera versión: webhook de alta de entradas, formulario de correo + localizador, caché de ficheros de Drive y clonado del header y el footer de la web anfitriona.

## Antecedentes · 2026-05-22
- *Recovery Tickets Service* en Salesforce: primer servicio de recuperación de entradas, del que nace este addon independiente.
