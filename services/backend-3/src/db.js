const { Pool } = require('pg');

let pool = null;
let isConnected = false;

function getDbConfig() {
  const host = process.env.DB_HOST || '';
  const port = parseInt(process.env.DB_PORT || '5432', 10);
  const user = process.env.DB_USER || 'postgres';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'orders_db';
  const useSsl = process.env.DB_SSL === 'true' || process.env.DB_SSL === '1';

  return {
    host,
    port,
    user,
    password,
    database,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  };
}

function getPool() {
  if (!pool) {
    const config = getDbConfig();
    if (!config.host) {
      return null;
    }
    pool = new Pool(config);
    pool.on('error', (err) => {
      console.error('[backend-3/db] Unexpected error on idle client:', err.message);
      isConnected = false;
    });
  }
  return pool;
}

async function initDb() {
  const p = getPool();
  if (!p) {
    console.log('[backend-3/db] DB_HOST not configured; operating in offline/mock mode.');
    isConnected = false;
    return false;
  }

  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      marker VARCHAR(255),
      item_id VARCHAR(255) NOT NULL,
      quantity INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  try {
    const client = await p.connect();
    try {
      await client.query(createTableQuery);
      isConnected = true;
      console.log('[backend-3/db] PostgreSQL database connected and table orders ensured.');
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('[backend-3/db] Database connection warning at startup:', err.message);
    isConnected = false;
    return false;
  }
}

async function checkHealth() {
  const p = getPool();
  if (!p) {
    return false;
  }
  try {
    const res = await p.query('SELECT 1 AS ok');
    isConnected = res.rows && res.rows[0].ok === 1;
    return isConnected;
  } catch (err) {
    isConnected = false;
    return false;
  }
}

async function createOrder({ item_id, quantity, marker = null }) {
  const p = getPool();
  if (!p) {
    throw new Error('Database not configured (DB_HOST missing)');
  }

  const query = `
    INSERT INTO orders (item_id, quantity, marker)
    VALUES ($1, $2, $3)
    RETURNING id, item_id, quantity, marker, created_at;
  `;
  const values = [item_id, quantity, marker];

  const res = await p.query(query, values);
  return res.rows[0];
}

async function getOrders({ marker = null, limit = 50 } = {}) {
  const p = getPool();
  if (!p) {
    throw new Error('Database not configured (DB_HOST missing)');
  }

  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);

  if (marker) {
    const query = `
      SELECT id, item_id, quantity, marker, created_at
      FROM orders
      WHERE marker = $1
      ORDER BY id DESC
      LIMIT $2;
    `;
    const res = await p.query(query, [marker, parsedLimit]);
    return res.rows;
  }

  const query = `
    SELECT id, item_id, quantity, marker, created_at
    FROM orders
    ORDER BY id DESC
    LIMIT $1;
  `;
  const res = await p.query(query, [parsedLimit]);
  return res.rows;
}

async function getLatestOrderByRunId(runId, maxSequence = null) {
  const p = getPool();
  if (!p) {
    throw new Error('Database not configured (DB_HOST missing)');
  }

  const prefix = `DR-${runId}-SEQ-`;
  const query = `
    SELECT id, item_id, quantity, marker, created_at
    FROM orders
    WHERE LEFT(marker, LENGTH($1)) = $1
      AND SUBSTRING(marker FROM LENGTH($1) + 1) ~ '^[0-9]{6,}$'
      AND ($2::NUMERIC IS NULL OR SUBSTRING(marker FROM LENGTH($1) + 1)::NUMERIC <= $2::NUMERIC)
    ORDER BY SUBSTRING(marker FROM LENGTH($1) + 1)::NUMERIC DESC, id DESC
    LIMIT 1;
  `;
  const res = await p.query(query, [prefix, maxSequence]);
  return res.rows[0] || null;
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
    isConnected = false;
  }
}

module.exports = {
  getDbConfig,
  getPool,
  initDb,
  checkHealth,
  createOrder,
  getOrders,
  getLatestOrderByRunId,
  close
};
