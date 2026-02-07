import { getNextClient, markAsCalled, updateClientStatus } from '../services/dripService.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENTS_FILE = path.join(__dirname, '../../clients.json');

async function runTests() {
  console.log('Starting Drip Logic Tests...');

  // Backup original file
  let originalData = '[]';
  try {
      originalData = await fs.readFile(CLIENTS_FILE, 'utf-8');
  } catch (e) {
      console.log("No existing clients.json found or empty.");
  }

  // Setup test data
  const testData = [
    { id: 1, name: "Test 1", phone: "123", status: "CALLED" },
    { id: 2, name: "Test 2", phone: "456", status: "PENDING" },
    { id: 3, name: "Test 3", phone: "789", status: "PENDING" }
  ];
  await fs.writeFile(CLIENTS_FILE, JSON.stringify(testData, null, 2));

  try {
    // Test 1: Get Next Client
    console.log('Test 1: getNextClient...');
    const client = await getNextClient();
    if (client && client.id === 2) {
      console.log('PASS: Correctly identified next PENDING client.');
    } else {
      console.error('FAIL: Expected client 2, got:', client);
    }

    // Test 2: Mark as Called
    console.log('Test 2: markAsCalled...');
    await markAsCalled(2);
    const updatedData = JSON.parse(await fs.readFile(CLIENTS_FILE, 'utf-8'));
    const client2 = updatedData.find(c => c.id === 2);
    if (client2.status === 'CALLED') {
      console.log('PASS: Client 2 status updated to CALLED.');
    } else {
      console.error('FAIL: Client 2 status is:', client2.status);
    }

    // Test 3: Get Next Client again (should be 3)
    console.log('Test 3: getNextClient again...');
    const nextClient = await getNextClient();
    if (nextClient && nextClient.id === 3) {
      console.log('PASS: Correctly identified next PENDING client (3).');
    } else {
      console.error('FAIL: Expected client 3, got:', nextClient);
    }

    // Test 4: Update Client Status
    console.log('Test 4: updateClientStatus...');
    await updateClientStatus(3, 'APPOINTMENT');
    const updatedData2 = JSON.parse(await fs.readFile(CLIENTS_FILE, 'utf-8'));
    const client3 = updatedData2.find(c => c.id === 3);
    if (client3.status === 'APPOINTMENT') {
        console.log('PASS: Client 3 status updated to APPOINTMENT.');
    } else {
        console.error('FAIL: Client 3 status is:', client3.status);
    }

  } catch (error) {
    console.error('Test Error:', error);
  } finally {
    // Restore original data
    await fs.writeFile(CLIENTS_FILE, originalData);
    console.log('Tests Completed. Original data restored.');
  }
}

runTests();
