import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

let app;
let stopServer;
let tempDir;

describe('OvO System smoke tests', () => {
    beforeAll(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovo-system-test-'));
        const tempDbPath = path.join(tempDir, 'inventory.db');

        execFileSync(process.execPath, ['server/db/init.js'], {
            cwd: ROOT_DIR,
            env: {
                ...process.env,
                NODE_ENV: 'test',
                DB_PATH: tempDbPath,
                SESSION_DB_DIR: tempDir,
                SESSION_SECRET: 'test-session-secret'
            },
            stdio: 'ignore'
        });

        process.env.NODE_ENV = 'test';
        process.env.SKIP_SERVER_START = 'true';
        process.env.DB_PATH = tempDbPath;
        process.env.SESSION_DB_DIR = tempDir;
        process.env.SESSION_SECRET = 'test-session-secret';
        process.env.COOKIE_SECURE = 'false';

        vi.resetModules();
        ({ app, stopServer } = await import('../server/index.js'));
    });

    afterAll(() => {
        if (typeof stopServer === 'function') {
            stopServer();
        }

        delete process.env.SKIP_SERVER_START;
        delete process.env.DB_PATH;
        delete process.env.SESSION_DB_DIR;
        delete process.env.SESSION_SECRET;
        delete process.env.COOKIE_SECURE;

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns healthy status', async () => {
        const response = await request(app).get('/api/health');
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.status).toBe('healthy');
    });

    it('can login and read protected endpoints', async () => {
        const agent = request.agent(app);

        const login = await agent
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'admin123' });

        expect(login.status).toBe(200);
        expect(login.body.success).toBe(true);

        const me = await agent.get('/api/auth/me');
        expect(me.status).toBe(200);
        expect(me.body.data.user.username).toBe('admin');

        const users = await agent.get('/api/users');
        expect(users.status).toBe(200);
        expect(users.body.success).toBe(true);

        const warehouses = await agent.get('/api/warehouses');
        expect(warehouses.status).toBe(200);
        expect(warehouses.body.success).toBe(true);
    });
});
