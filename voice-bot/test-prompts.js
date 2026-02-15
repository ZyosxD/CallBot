import { getSystemPrompt } from './src/config/prompts.js';

console.log('--- Inbound Prompt ---');
const inbound = getSystemPrompt('inbound', { callerId: '+1234567890' });
console.log(inbound);

if (!inbound.includes('INBOUND SALES RECEPTIONIST') || !inbound.includes('Sarah')) {
    console.error('FAIL: Inbound prompt missing key elements');
    process.exit(1);
}

console.log('\n--- Outbound Prompt ---');
const outbound = getSystemPrompt('outbound', { id: '1', callerId: '+18015550100' });
console.log(outbound);

if (!outbound.includes('OUTBOUND COLD CALLER') || !outbound.includes('Gatekeeper Navigation')) {
    console.error('FAIL: Outbound prompt missing key elements');
    process.exit(1);
}

console.log('\nSUCCESS: Prompts generated correctly.');
