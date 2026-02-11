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
    port: process.env.SMTP_PORT || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    notificationEmail: process.env.NOTIFICATION_EMAIL
  },
  schedule: {
    timezone: 'America/Denver',
    morning: {
      start: '30 9 * * 1-5', // 9:30 AM Mon-Fri
      end: '30 11 * * 1-5'   // 11:30 AM Mon-Fri
    },
    afternoon: {
      start: '30 14 * * 1-5', // 2:30 PM Mon-Fri
      end: '30 15 * * 1-5'    // 3:30 PM Mon-Fri
    }
  }
};
