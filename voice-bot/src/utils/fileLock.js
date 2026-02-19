import fs from 'fs/promises';

class FileLock {
  constructor() {
    this.locks = new Map();
  }

  async acquire(filepath) {
    while (this.locks.get(filepath)) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    this.locks.set(filepath, true);
  }

  release(filepath) {
    this.locks.delete(filepath);
  }

  async read(filepath) {
    await this.acquire(filepath);
    try {
      const data = await fs.readFile(filepath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return []; // Return empty array if file doesn't exist
      }
      throw error;
    } finally {
      this.release(filepath);
    }
  }

  async write(filepath, data) {
    await this.acquire(filepath);
    try {
      await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
    } finally {
      this.release(filepath);
    }
  }

  async update(filepath, updateFn) {
    await this.acquire(filepath);
    try {
      let data = [];
      try {
        const fileContent = await fs.readFile(filepath, 'utf8');
        data = JSON.parse(fileContent);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }

      const newData = await updateFn(data);
      await fs.writeFile(filepath, JSON.stringify(newData, null, 2), 'utf8');
      return newData;
    } finally {
      this.release(filepath);
    }
  }
}

// Export a singleton instance
const fileLock = new FileLock();
export default fileLock;
