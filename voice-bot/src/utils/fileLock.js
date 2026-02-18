const locks = {};

/**
 * Execute a callback with a lock on a specific key (e.g., file path).
 * Ensures sequential execution of async operations for the same key.
 * @param {string} key - The identifier for the lock (e.g., file path).
 * @param {Function} callback - The async function to execute.
 * @returns {Promise<any>} - The result of the callback.
 */
export const withLock = async (key, callback) => {
  if (!locks[key]) {
    locks[key] = Promise.resolve();
  }

  const currentLock = locks[key];
  let release;

  const nextLock = new Promise(resolve => {
    release = resolve;
  });

  // Update the lock tail immediately so next caller waits for this one
  locks[key] = nextLock;

  // Wait for previous operation to finish (ignoring errors)
  return currentLock
    .catch(() => {})
    .then(async () => {
      try {
        return await callback();
      } finally {
        release();
      }
    });
};
