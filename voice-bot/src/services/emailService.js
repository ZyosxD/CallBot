import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter;

if (config.email.user && config.email.pass) {
    transporter = nodemailer.createTransport({
        host: config.email.host,
        port: config.email.port,
        auth: {
            user: config.email.user,
            pass: config.email.pass,
        },
    });
} else {
    logger.warn('SMTP credentials not provided. Email notifications will be skipped.');
}

export const sendSuccessEmail = async (leadData) => {
    if (!transporter) return;

    const htmlContent = `
        <h2>🟢 SUCCESS: New Technical Assessment Scheduled</h2>
        <p><strong>Contact Name:</strong> ${leadData.contactName}</p>
        <p><strong>Company Name:</strong> ${leadData.companyName}</p>
        <p><strong>Caller ID (Twilio):</strong> ${leadData.callerId}</p>
        <p><strong>Confirmed Phone:</strong> ${leadData.confirmedPhone}</p>
        <p><strong>Appointment Time:</strong> ${leadData.appointmentTime}</p>
        <p><strong>Notes:</strong> ${leadData.notes || 'N/A'}</p>
        <p><strong>Call SID:</strong> ${leadData.callSid}</p>
    `;

    try {
        await transporter.sendMail({
            from: `"Sarah Assistant" <${config.email.user}>`,
            to: config.email.to || config.email.user,
            subject: '🟢 SUCCESS: New Technical Assessment',
            html: htmlContent
        });
        logger.info(`Success email sent for call ${leadData.callSid}`);
    } catch (error) {
        logger.error('Failed to send success email:', error);
    }
};

export const sendReportEmail = async (interactionData) => {
    if (!transporter) return;

    const htmlContent = `
        <h2>🟠 REPORT: Client Interaction</h2>
        <p><strong>Caller ID (Twilio):</strong> ${interactionData.callerId}</p>
        <p><strong>Reason:</strong> ${interactionData.reason}</p>
        <p><strong>Notes:</strong> ${interactionData.notes || 'N/A'}</p>
        <p><strong>Call SID:</strong> ${interactionData.callSid}</p>
    `;

    try {
        await transporter.sendMail({
            from: `"Sarah Assistant" <${config.email.user}>`,
            to: config.email.to || config.email.user,
            subject: '🟠 REPORT: Client Interaction',
            html: htmlContent
        });
        logger.info(`Report email sent for call ${interactionData.callSid}`);
    } catch (error) {
        logger.error('Failed to send report email:', error);
    }
};
