import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter;

try {
    if (config.email.user && config.email.pass) {
        transporter = nodemailer.createTransport({
            host: config.email.host,
            port: config.email.port,
            secure: config.email.port == 465,
            auth: {
                user: config.email.user,
                pass: config.email.pass,
            },
        });
    }
} catch (e) {
    logger.error('Error configuring nodemailer:', e);
}

export const sendSuccessEmail = async (leadData) => {
    if (!transporter) {
        logger.warn('Nodemailer transporter not configured. Skipping success email.');
        return;
    }

    const subject = '🟢 SUCCESS: New Technical Assessment Scheduled';

    const text = `
A new Technical Assessment has been scheduled!

Details:
- Contact Name: ${leadData.contactName}
- Company: ${leadData.companyName}
- Appointment Time: ${leadData.appointmentTime}

Phone Comparison:
- Original Caller ID (Twilio): ${leadData.callerId}
- Verbally Confirmed Phone: ${leadData.confirmedPhone}
    `.trim();

    try {
        await transporter.sendMail({
            from: `"1Wire Assistant" <${config.email.user}>`,
            to: config.email.to,
            subject: subject,
            text: text
        });
        logger.info('Success email sent for lead: ' + leadData.id);
    } catch (e) {
        logger.error('Failed to send success email:', e);
    }
};

export const sendReportEmail = async (interactionData) => {
    if (!transporter) {
        logger.warn('Nodemailer transporter not configured. Skipping report email.');
        return;
    }

    const subject = `🟠 REPORT: Interaction Outcome - ${interactionData.outcome}`;

    const text = `
Interaction Report:

- Outcome: ${interactionData.outcome}
- Notes: ${interactionData.notes || 'No notes provided'}
- Original Caller ID: ${interactionData.callerId}
    `.trim();

    try {
        await transporter.sendMail({
            from: `"1Wire Assistant" <${config.email.user}>`,
            to: config.email.to,
            subject: subject,
            text: text
        });
        logger.info('Report email sent for interaction: ' + interactionData.id);
    } catch (e) {
        logger.error('Failed to send report email:', e);
    }
};
