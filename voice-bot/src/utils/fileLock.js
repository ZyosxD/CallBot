import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '../data');

const locks = {};

const execute = (key, fn) => {
    if (!locks[key]) {
        locks[key] = Promise.resolve();
    }

    const next = locks[key].then(() => fn());
    // Update the lock to the new promise, catching errors to keep the chain alive
    locks[key] = next.catch(() => {});
    return next;
};

export const readJson = (filename) => {
    const filePath = path.join(dataDir, filename);
    return execute(filename, async () => {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            if (error.code === 'ENOENT') return [];
            throw error;
        }
    });
};

export const writeJson = (filename, data) => {
    const filePath = path.join(dataDir, filename);
    return execute(filename, async () => {
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    });
};

export const appendJson = (filename, item) => {
    const filePath = path.join(dataDir, filename);
    return execute(filename, async () => {
        let data = [];
        try {
            const content = await fs.readFile(filePath, 'utf8');
            data = JSON.parse(content);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        data.push(item);
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    });
};
