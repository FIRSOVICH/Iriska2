import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

// Fly.io Postgres даёт DATABASE_URL, локально — отдельные переменные
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
    }
  : {
      host:     process.env.DB_HOST     || 'localhost',
      port:     Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME     || 'iriska',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD,
    };

export const pool = new Pool({
  ...poolConfig,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

export const query = (text: string, params?: unknown[]) =>
  pool.query(text, params);

export default pool;
