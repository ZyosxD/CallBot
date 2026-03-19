import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendNotification } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsFilePath = path.join(__dirname, '../data/leads.json');
const interactionsFilePath = path.join(__dirname, '../data/interactions.json');

// Ensure data files exist
const ensureFile = (filepath) => {
    if (!fs.existsSync(filepath)) {
        fs.mkdirSync(path.dirname(filepath), { recursive: true });
        fs.writeFileSync(filepath, JSON.stringify([], null, 2));
    }
};

const appendToFile = (filepath, record) => {
    ensureFile(filepath);
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    data.push(record);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
};

export class OpenAIRealtimeService {
    constructor(ws, callSid, callerId, mode) {
        this.ws = ws;
        this.callSid = callSid;
        this.callerId = callerId;
        this.mode = mode;
        this.openaiWs = null;
        this.streamSid = null;
        this.isEnding = false;
    }

    async connect() {
        try {
            this.openaiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
                headers: {
                    'Authorization': `Bearer ${config.openai.apiKey}`,
                    'OpenAI-Beta': 'realtime=v1',
                },
            });

            this.openaiWs.on('open', () => {
                logger.info(`Connected to OpenAI Realtime API for call ${this.callSid}`);
                this.sendSessionUpdate();
            });

            this.openaiWs.on('message', (data) => {
                this.handleOpenAIMessage(data);
            });

            this.openaiWs.on('error', (error) => {
                logger.error('OpenAI WebSocket Error:', error);
            });

            this.openaiWs.on('close', () => {
                logger.info('OpenAI WebSocket Closed');
            });

        } catch (error) {
            logger.error('Error connecting to OpenAI:', error);
        }
    }

    sendSessionUpdate() {
        const systemInstruction = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

        const sessionUpdate = {
            type: 'session.update',
            session: {
                turn_detection: {
                    type: 'server_vad',
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 1500
                },
                input_audio_format: 'g711_ulaw',
                output_audio_format: 'g711_ulaw',
                voice: 'coral',
                instructions: systemInstruction,
                modalities: ["text", "audio"],
                temperature: 0.8,
                tools: [
                    {
                        type: "function",
                        name: "schedule_appointment",
                        description: "Schedule a Technical Assessment after confirming the Trifecta and Exact Time.",
                        parameters: {
                            type: "object",
                            properties: {
                                contactName: { type: "string", description: "Name of the person to speak with." },
                                companyName: { type: "string", description: "Company Name." },
                                confirmedPhone: { type: "string", description: "The best phone number to call back." },
                                appointmentTime: { type: "string", description: "The exact time agreed upon." }
                            },
                            required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
                        }
                    },
                    {
                        type: "function",
                        name: "report_interaction",
                        description: "Report when the client is not interested, went to voicemail, or wants to be called back later.",
                        parameters: {
                            type: "object",
                            properties: {
                                reason: { type: "string", description: "The reason for not scheduling (e.g., 'Not interested', 'Voicemail', 'Call back later')." },
                                notes: { type: "string", description: "Any other relevant notes." }
                            },
                            required: ["reason"]
                        }
                    },
                    {
                        type: "function",
                        name: "end_call",
                        description: "End the call gracefully after finishing the conversation.",
                        parameters: {
                            type: "object",
                            properties: {},
                        }
                    }
                ],
                tool_choice: "auto"
            },
        };
        this.sendToOpenAI(sessionUpdate);

        // Instruct OpenAI to speak first with a specific greeting based on mode
        let initialSpeech = '';
        if (this.mode === 'outbound') {
             initialSpeech = "Start the conversation immediately by saying: 'Hi, are you the one who handles the tech, or should I ask for the Office Manager?'";
        } else {
             initialSpeech = "Start the conversation immediately by saying: 'Thanks for calling 1Wire. Are you looking to upgrade your internet, phone system, or IT support?'";
        }

        this.sendToOpenAI({
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: initialSpeech }]
            }
        });

        this.sendToOpenAI({ type: 'response.create' });
    }

    async handleOpenAIMessage(data) {
        try {
            const event = JSON.parse(data);

            if (event.type === 'response.audio.delta' && event.delta) {
                this.sendAudioToTwilio(event.delta);
            }

            if (event.type === 'response.audio_transcript.done') {
                logConversation(this.callSid, 'Assistant', event.transcript);
            }

            if (event.type === 'conversation.item.input_audio_transcription.completed') {
                logConversation(this.callSid, 'User', event.transcript);
            }

            if (event.type === 'response.function_call_arguments.done') {
                await this.handleFunctionCall(event);
            }

        } catch (error) {
            logger.error('Error parsing OpenAI message:', error);
        }
    }

    async handleFunctionCall(event) {
        const { name, arguments: args, call_id: callId } = event;
        const parsedArgs = JSON.parse(args);

        logger.info(`Function call detected: ${name} with args: ${args}`);
        let result = null;

        try {
            if (name === 'schedule_appointment') {
                const leadRecord = {
                    timestamp: new Date().toISOString(),
                    callSid: this.callSid,
                    callerId: this.callerId,
                    contactName: parsedArgs.contactName,
                    companyName: parsedArgs.companyName,
                    confirmedPhone: parsedArgs.confirmedPhone,
                    appointmentTime: parsedArgs.appointmentTime
                };
                appendToFile(leadsFilePath, leadRecord);
                await sendNotification('SUCCESS', leadRecord);
                result = { status: "Success", message: "Appointment Scheduled." };

            } else if (name === 'report_interaction') {
                const interactionRecord = {
                    timestamp: new Date().toISOString(),
                    callSid: this.callSid,
                    callerId: this.callerId,
                    reason: parsedArgs.reason,
                    notes: parsedArgs.notes || ''
                };
                appendToFile(interactionsFilePath, interactionRecord);
                await sendNotification('REPORT', interactionRecord);
                result = { status: "Success", message: "Interaction Logged." };

            } else if (name === 'end_call') {
                result = { status: "Success", message: "Ending Call." };
                if (!this.isEnding) {
                    this.isEnding = true;
                    this.handleEndCall();
                }
            }

            // Send result back to OpenAI
            const functionOutput = {
                type: 'conversation.item.create',
                item: {
                    type: 'function_call_output',
                    call_id: callId,
                    output: JSON.stringify(result)
                }
            };
            this.sendToOpenAI(functionOutput);

            // Generate another response unless we are ending the call
            if (name !== 'end_call') {
                this.sendToOpenAI({ type: 'response.create' });
            }

        } catch (error) {
            logger.error(`Error executing function ${name}:`, error);
        }
    }

    handleEndCall() {
        logger.info(`Initiating end_call sequence for ${this.callSid}`);

        // Instruct OpenAI to say a final polite goodbye
        this.sendToOpenAI({
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: "Please say a very short, polite goodbye." }]
            }
        });
        this.sendToOpenAI({ type: 'response.create' });

        // Wait 10 seconds before forcefully closing the socket
        setTimeout(() => {
            logger.info(`Closing websockets for ${this.callSid} after 10s delay`);
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                this.openaiWs.close();
            }
        }, 10000);
    }

    sendAudioToTwilio(audioPayload) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.streamSid) {
            const audioDelta = {
                event: 'media',
                streamSid: this.streamSid,
                media: {
                    payload: audioPayload
                }
            };
            this.ws.send(JSON.stringify(audioDelta));
        }
    }

    sendToOpenAI(data) {
        if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
            this.openaiWs.send(JSON.stringify(data));
        }
    }

    handleTwilioMedia(data) {
        if (data.event === 'start') {
            this.streamSid = data.start.streamSid;
            // Note: CallSid is set in constructor but updated here explicitly if needed
            this.callSid = data.start.callSid;
            logger.info(`Stream started: ${this.streamSid}`);
        } else if (data.event === 'media') {
            const audioAppend = {
                type: 'input_audio_buffer.append',
                audio: data.media.payload
            };
            this.sendToOpenAI(audioAppend);
        }
    }
}
