import fs from 'node:fs';
import { config, getOriginalsDir, getTmpDir } from '../src/config.js';
import { getDb } from '../src/db.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(getOriginalsDir(), { recursive: true });
fs.mkdirSync(getTmpDir(), { recursive: true });
getDb();
console.log(`DB siap di ${config.dbPath}`);
