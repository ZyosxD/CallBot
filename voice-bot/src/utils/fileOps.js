import fs from 'fs/promises';
import path from 'path';

export const appendToJsonFile = async (filepath, data) => {
  try {
    const fileExists = await fs.access(filepath).then(() => true).catch(() => false);
    let currentData = [];
    if (fileExists) {
      const fileContent = await fs.readFile(filepath, 'utf8');
      if (fileContent.trim()) {
         currentData = JSON.parse(fileContent);
      }
    }
    currentData.push(data);
    await fs.writeFile(filepath, JSON.stringify(currentData, null, 2), 'utf8');
  } catch (error) {
    console.error(`Error writing to ${filepath}:`, error);
  }
};
