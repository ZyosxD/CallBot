const queues = {};

/**
 * Executes a callback function with a lock on the given file path (or key).
 * Ensures that subsequent calls with the same key wait for the previous ones to complete.
 *
 * @param {string} key - The key to lock on (e.g., file path).
 * @param {Function} callback - The async function to execute.
 * @returns {Promise<any>} The result of the callback.
 */
export const withLock = async (key, callback) => {
  if (!queues[key]) {
    queues[key] = Promise.resolve();
  }

  // Chain the new operation to the existing promise chain
  const resultPromise = queues[key].then(async () => {
    return await callback();
  });

  // Update the queue to wait for this operation's completion (success or failure)
  // We catch errors here so the chain doesn't break for future operations
  queues[key] = resultPromise.catch(() => {});

  return resultPromise;
};
