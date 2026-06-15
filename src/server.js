require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { LOCAL_ROOT, DRIVER, validateS3Config } = require('./services/storage');

const app = express();

app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use('/media', require('./routes/media'));

async function start() {
  try {
    if (DRIVER === 'local') {
      console.log(`Object storage: local (${LOCAL_ROOT})`);
    } else {
      await validateS3Config();
      console.log(`Object storage: s3 (${process.env.S3_BUCKET}, ${process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1'})`);
    }
  } catch (err) {
    console.error('Storage configuration error:', err.message);
    process.exit(1);
  }

  // Routes
  app.use('/auth',  require('./routes/auth'));
  app.use('/users', require('./routes/users'));
  app.use('/roles', require('./routes/roles'));
  app.use('/entities', require('./routes/entities'));
  app.use('/employees', require('./routes/employees'));

  // Health check
  app.get('/health', (_, res) => res.json({
    status: 'ok',
    time: new Date().toISOString(),
    storage: DRIVER,
  }));

  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`VMS API running on http://localhost:${PORT}`));
}

start().catch(err => {
  console.error(err);
  process.exit(1);
});
