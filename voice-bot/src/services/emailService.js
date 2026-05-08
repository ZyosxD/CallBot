import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter = null;

if (config.email.host && config.email.user) {
    transporter = nodemailer.createTransport({
        host: config.email.host,
        port: parseInt(config.email.port || '587'),
        secure: parseInt(config.email.port || '587') === 465, // true for 465, false for other ports
        auth: {
            user: config.email.user,
            pass: config.email.pass,
        },
    });
} else {
    logger.warn('SMTP configuration is missing. Emails will not be sent.');
}

export const sendSuccessEmail = async (clientData, callerId) => {
    if (!transporter) return;

    try {
        const info = await transporter.sendMail({
            from: config.email.from,
            to: config.email.to,
            subject: '🟢 SUCCESS: New Technical Assessment Scheduled!',
            text: `
We have successfully scheduled a new Technical Assessment!

Contact Details:
- Contact Name: ${clientData.contactName}
- Company Name: ${clientData.companyName}
- Appointment Time: ${clientData.appointmentTime}

Phone Verification:
- Verbally Confirmed Phone: ${clientData.confirmedPhone}
- Twilio Caller ID: ${callerId || 'Unknown'}
            `.trim()
        });
        logger.info(`Success email sent: ${info.messageId}`);
    } catch (error) {
        logger.error('Error sending success email:', error);
    }
};

export const sendReportEmail = async (reportData, callerId) => {
    if (!transporter) return;

    try {
        const info = await transporter.sendMail({
            from: config.email.from,
            to: config.email.to,
            subject: '🟠 REPORT: Interaction Logged',
            text: `
An interaction was logged that did not result in an appointment.

Interaction Details:
- Reason: ${reportData.reason}
- Notes: ${reportData.notes || 'None'}

Phone Verification:
- Twilio Caller ID: ${callerId || 'Unknown'}
            `.trim()
        });
        logger.info(`Report email sent: ${info.messageId}`);
    } catch (error) {
        logger.error('Error sending report email:', error);
    }
};
