import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to resolve paths relative to project root
const resolvePath = (relativePath) => {
  // Assuming this file is in src/utils/
  return path.join(__dirname, '../../', relativePath);
};

export const readJsonFile = (relativePath) => {
  try {
    const fullPath = resolvePath(relativePath);
    if (!fs.existsSync(fullPath)) {
      return [];
    }
    const data = fs.readFileSync(fullPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading file ${relativePath}:`, error);
    return [];
  }
};

export const writeJsonFile = (relativePath, data) => {
  try {
    const fullPath = resolvePath(relativePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error(`Error writing file ${relativePath}:`, error);
    return false;
  }
};
