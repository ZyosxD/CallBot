import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

export const transferToHuman = (callSid) => {
  try {
    const client = twilio(config.twilio.accountSid, config.twilio.authToken);

    // In a real scenario, this would update the call to dial a real number
    // Since we are just responding with XML in the controller usually,
    // this service might be used to update an ongoing call via API

    // For this implementation, we will return TwiML to be used by the controller
    // or used to update the call if it's async.

    const response = new twilio.twiml.VoiceResponse();
    response.say('Transferring you to a human agent. Please hold.');
    response.dial('+15555555555'); // Replace with actual support number

    logger.info(\`Generating transfer TwiML for call \${callSid}\`);
    return response.toString();

  } catch (error) {
    logger.error('Error transferring call:', error);
    throw error;
  }
};
