import twilio from 'twilio';
import logger from '../utils/logger.js';

export const transferToHuman = (callSid) => {
    logger.info(`Generating transfer TwiML for call ${callSid}`);
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();
    response.say('Transferring to a human agent.');
    // Mock transfer logic
    return response.toString();
};
