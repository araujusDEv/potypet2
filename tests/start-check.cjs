const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
module.exports = async function check(label, test) {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'adotapet-security-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      ADMIN_EMAIL: 'admin@adotapet.com',
      ADMIN_PASSWORD: '',
      DONOR_EMAIL: 'ong@adotapet.com',
      DONOR_PASSWORD: '',
      ADMIN_RECOVERY_ID: '',
      DONOR_NAME: '',
      NODE_ENV: 'test',
      EMAIL_TRANSPORT: 'disabled',
      SEED_SAMPLE_DATA: '1',
      BACKUP_AUTO: '0',
      HOST: '127.0.0.1',
      PORT: '3170',
      DATA_DIR: dir,
      SEED_DEMO_ACCOUNTS: '1',
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  try {
    await new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        if (log.includes('PotyPet rodando')) {
          clearInterval(timer);
          resolve();
        } else if (child.exitCode !== null) {
          clearInterval(timer);
          reject(new Error(log));
        }
      }, 50);
      setTimeout(() => {
        clearInterval(timer);
        reject(new Error('Startup timeout: ' + log));
      }, 10000).unref();
    });
    const r = await fetch('http://127.0.0.1:3170/api/health');
    if (!r.ok) throw Error('health');
    if (test) await test({ dataDir: dir });
    console.log('OK startup node server.js — ' + label);
  } finally {
    child.kill();
    await new Promise((r) => child.once('exit', r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
if (require.main === module)
  module.exports(process.argv[2] || 'check').catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
