import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

// Create transporter
const transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.port == 465, // true for 465, false for other ports
    auth: {
        user: config.email.user,
        pass: config.email.pass
    }
});

/**
 * Sends a SUCCESS or REPORT email.
 * @param {string} type - 'SUCCESS' or 'REPORT'
 * @param {object} data - The collected data from the call
 */
export const sendNotificationEmail = async (type, data) => {
    try {
        if (!config.email.to || !config.email.user) {
            logger.warn('Email configuration is missing, skipping email notification.');
            return;
        }

        const isSuccess = type === 'SUCCESS';
        const subject = isSuccess
            ? `🟢 SUCCESS: New Technical Assessment Scheduled - ${data.companyName || 'Unknown Company'}`
            : `🟠 REPORT: Interaction Logged - Call Outcome`;

        // Check phone numbers
        const callerId = data.callerId || 'Unknown Caller ID';
        const confirmedPhone = data.confirmedPhone || 'Not Confirmed verbally';

        const phoneComparison = `
Caller ID (Twilio): ${callerId}
Confirmed Verbally: ${confirmedPhone}
${callerId !== confirmedPhone ? '⚠️ WARNING: Numbers do not match!' : '✅ Numbers match.'}
        `.trim();

        let textBody = '';
        if (isSuccess) {
            textBody = `
A new Technical Assessment has been scheduled!

Company Name: ${data.companyName || 'N/A'}
Contact Name: ${data.contactName || 'N/A'}
Time: ${data.appointmentTime || 'N/A'}

Phone Comparison:
${phoneComparison}

Notes / Needs: ${data.notes || 'No specific notes recorded.'}
            `.trim();
        } else {
            textBody = `
An interaction was logged without scheduling an appointment.

Phone Comparison:
${phoneComparison}

Outcome Details: ${data.outcome || 'No specific outcome logged.'}
            `.trim();
        }

        const mailOptions = {
            from: config.email.from,
            to: config.email.to,
            subject: subject,
            text: textBody
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info(`Email sent successfully: ${info.messageId}`);
    } catch (error) {
        logger.error('Error sending email:', error);
    }
};
