import dotenv from 'dotenv';
dotenv.config();

export const config = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
  },
  server: {
    port: process.env.PORT || 3000,
    publicUrl: process.env.PUBLIC_URL,
  },
  email: {
    smtpHost: process.env.SMTP_HOST,
    smtpPort: process.env.SMTP_PORT,
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
    notificationEmail: process.env.NOTIFICATION_EMAIL,
  }
};
