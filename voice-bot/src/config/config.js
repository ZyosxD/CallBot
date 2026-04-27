import dotenv from 'dotenv';
dotenv.config();

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
  email: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    to: process.env.REPORT_EMAIL_TO || 'reports@1wire.co',
    from: process.env.REPORT_EMAIL_FROM || 'reports@1wire.co'
  }
};
