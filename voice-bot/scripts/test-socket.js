import { OpenAIRealtimeService } from '../src/services/openaiRealtime.js';
import { prompts } from '../src/config/prompts.js';

// Mock WebSocket
const mockWs = {
  on: () => {},
  send: (msg) => {
    // This mocks the Twilio WS, but OpenAIRealtimeService sends to openaiWs
  },
  readyState: 1 // OPEN
};

// Instantiate Service
const service = new OpenAIRealtimeService(mockWs, 'test-sid', 'inbound');

// Mock the OpenAI WebSocket inside the service
service.openaiWs = {
    readyState: 1,
    send: (msg) => {
        const data = JSON.parse(msg);
        if (data.type === 'session.update') {
            const sentInstruction = data.session.instructions;
            // Normalize strings to avoid newline/spacing issues
            const normSent = sentInstruction.replace(/\s+/g, ' ').trim();
            const normExpected = prompts.inboundSystemInstruction.replace(/\s+/g, ' ').trim();

            if (normSent === normExpected) {
                console.log('SUCCESS: Inbound instruction sent correctly.');
            } else {
                console.error('FAILURE: Instructions do not match.');
                console.error('Expected length:', normExpected.length);
                console.error('Got length:', normSent.length);
                process.exit(1);
            }
        }
    },
    on: () => {}
};

console.log('Starting Test: Inbound Prompt Selection');
try {
    service.sendSessionUpdate();
} catch (e) {
    console.error('Error running test:', e);
    process.exit(1);
}
