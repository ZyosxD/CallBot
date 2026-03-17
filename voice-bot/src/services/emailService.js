import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

export const sendSuccessEmail = async (appointmentData, originalCallerId) => {
    try {
        const mailOptions = {
            from: `"Sarah (1Wire AI)" <${process.env.SMTP_USER}>`,
            to: process.env.NOTIFICATION_EMAIL || process.env.SMTP_USER,
            subject: '🟢 SUCCESS: New Technical Assessment Scheduled',
            text: `
A new Technical Assessment has been scheduled!

Details:
- Contact Name: ${appointmentData.contactName}
- Company Name: ${appointmentData.companyName}
- Appointment Time: ${appointmentData.appointmentTime}
- Notes: ${appointmentData.notes || 'None'}

Phone Verification:
- Original Caller ID: ${originalCallerId}
- Verbally Confirmed Phone: ${appointmentData.confirmedPhone}
            `
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info(`Success Email sent: ${info.messageId}`);
    } catch (error) {
        logger.error('Error sending success email:', error);
    }
};

export const sendReportEmail = async (interactionData, originalCallerId) => {
    try {
        const mailOptions = {
            from: `"Sarah (1Wire AI)" <${process.env.SMTP_USER}>`,
            to: process.env.NOTIFICATION_EMAIL || process.env.SMTP_USER,
            subject: '🟠 REPORT: Interaction Logged',
            text: `
An interaction was logged.

Details:
- Reason: ${interactionData.reason}
- Notes: ${interactionData.notes || 'None'}

Phone Verification:
- Original Caller ID: ${originalCallerId}
            `
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info(`Report Email sent: ${info.messageId}`);
    } catch (error) {
        logger.error('Error sending report email:', error);
    }
};
