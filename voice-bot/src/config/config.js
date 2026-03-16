import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Provide absolute path to .env file since fastify might run from a different root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

export const config = {
  server: {
    port: process.env.PORT || 3000,
    publicUrl: process.env.PUBLIC_URL
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY
  },
  smtp: {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  notifications: {
    email: process.env.NOTIFICATION_EMAIL
  }
};
