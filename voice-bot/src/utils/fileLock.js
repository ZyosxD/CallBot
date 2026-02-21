import fs from 'fs/promises';
import path from 'path';
import logger from './logger.js';

// Simple mutex for within-process safety
const locks = {};

const acquireLock = async (filepath) => {
  while (locks[filepath]) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  locks[filepath] = true;
};

const releaseLock = (filepath) => {
  locks[filepath] = false;
};

export const readJsonFile = async (filepath) => {
  try {
    const data = await fs.readFile(filepath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};

export const writeJsonFile = async (filepath, data) => {
  await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
};

export const updateJsonFile = async (filepath, updateFn) => {
  await acquireLock(filepath);
  try {
    const data = await readJsonFile(filepath);
    const newData = await updateFn(data);
    if (newData) {
        await writeJsonFile(filepath, newData);
    }
    return newData;
  } catch (error) {
    logger.error(`Error updating file ${filepath}: ${error.message}`);
    throw error;
  } finally {
    releaseLock(filepath);
  }
};
