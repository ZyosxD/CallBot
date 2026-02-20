import fs from 'fs/promises';
import path from 'path';

const locks = new Map();

/**
 * Acquires a lock for a given file path.
 * Returns a function that releases the lock.
 */
async function acquireLock(filePath) {
  if (!locks.has(filePath)) {
    locks.set(filePath, Promise.resolve());
  }

  const currentLock = locks.get(filePath);
  let release;

  const newLock = new Promise((resolve) => {
    release = resolve;
  });

  // Chain the new lock to the current one
  const nextLock = currentLock.then(() => newLock);
  locks.set(filePath, nextLock);

  // Wait for the previous lock to release
  await currentLock;

  return () => {
    release();
    // Clean up if this is the last lock? (Optional, but good for memory)
    // In a simple implementation, the chain grows but resolved promises are cheap.
    // A more robust implementation would clean up.
  };
}

export async function readJsonFile(filePath) {
  const release = await acquireLock(filePath);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []; // Default to empty array if file doesn't exist
    }
    throw error;
  } finally {
    release();
  }
}

export async function writeJsonFile(filePath, data) {
  const release = await acquireLock(filePath);
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } finally {
    release();
  }
}
