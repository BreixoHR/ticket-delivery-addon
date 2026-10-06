import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'tickets.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drive_url TEXT NOT NULL,
    email TEXT NOT NULL,
    localizador TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export function insertTicket({ driveUrl, email, localizador }) {
  const stmt = db.prepare(
    'INSERT INTO tickets (drive_url, email, localizador) VALUES (?, ?, ?)'
  );
  return stmt.run(driveUrl, email, localizador);
}

export function updateTicketUrl({ driveUrl, localizador }) {
  const stmt = db.prepare('UPDATE tickets SET drive_url = ? WHERE localizador = ?');
  return stmt.run(driveUrl, localizador);
}

export function findTicket({ email, localizador }) {
  return db
    .prepare('SELECT * FROM tickets WHERE email = ? AND localizador = ?')
    .get(email, localizador);
}

export function findTicketById(id) {
  return db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
}

export function findTicketByLocalizador(localizador) {
  return db.prepare('SELECT * FROM tickets WHERE localizador = ?').get(localizador);
}
