import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const createTransporter = () => {
    return nodemailer.createTransport({
        host: config.email.smtpHost,
        port: config.email.smtpPort,
        secure: false, // true for 465, false for other ports
        auth: {
            user: config.email.smtpUser,
            pass: config.email.smtpPass,
        },
    });
};

export const sendSuccessEmail = async (appointmentData, twilioCallerId) => {
    try {
        const transporter = createTransporter();
        const { contactName, companyName, verifiedPhone, appointmentTime } = appointmentData;

        const mailOptions = {
            from: config.email.smtpFrom,
            to: config.email.smtpTo,
            subject: '🟢 SUCCESS: Technical Assessment Scheduled',
            text: `A new Technical Assessment has been scheduled!

Details:
- Contact Name: ${contactName}
- Company Name: ${companyName}
- Exact Appointment Time: ${appointmentTime}

Phone Verification:
- Twilio Caller ID: ${twilioCallerId || 'Unknown'}
- Client Verified Phone: ${verifiedPhone}

Please follow up accordingly.`,
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info(`Success email sent: ${info.messageId}`);
    } catch (error) {
        logger.error('Error sending success email:', error);
    }
};

export const sendReportEmail = async (interactionData, twilioCallerId) => {
    try {
        const transporter = createTransporter();
        const { summary, outcome } = interactionData;

        const mailOptions = {
            from: config.email.smtpFrom,
            to: config.email.smtpTo,
            subject: '🟠 REPORT: Interaction Logged',
            text: `An interaction has been logged.

Details:
- Outcome: ${outcome}
- Summary: ${summary}

Phone Verification:
- Twilio Caller ID: ${twilioCallerId || 'Unknown'}

Please review if necessary.`,
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info(`Report email sent: ${info.messageId}`);
    } catch (error) {
        logger.error('Error sending report email:', error);
    }
};
