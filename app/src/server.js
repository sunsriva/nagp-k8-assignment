const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

// Connection pool — config fully sourced from env vars (ConfigMap + Secret)
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected DB pool error:', err.message);
});

// Kubernetes liveness probe
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Kubernetes readiness probe — verifies DB connectivity
app.get('/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ready', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'not ready', db: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    service: 'NAGP 2026 K8s Assignment — Product API',
    version: '1.0.0',
    endpoints: {
      products: '/api/products',
      productById: '/api/products/:id',
      health: '/health',
      ready: '/ready',
    },
  });
});

app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, category, price, stock_quantity, description, created_at FROM products ORDER BY id'
    );
    res.json({
      success: true,
      count: result.rows.length,
      source: `${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
      data: result.rows,
    });
  } catch (err) {
    console.error('Query error:', err.message);
    res.status(500).json({ success: false, error: 'Database query failed' });
  }
});

app.get('/api/products/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid id' });
  }
  try {
    const result = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('Query error:', err.message);
    res.status(500).json({ success: false, error: 'Database query failed' });
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received — draining connections');
  await pool.end();
  process.exit(0);
});

const PORT = parseInt(process.env.APP_PORT, 10) || 3000;
app.listen(PORT, () => {
  console.log(`API service listening on port ${PORT}`);
  console.log(`DB: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
});
