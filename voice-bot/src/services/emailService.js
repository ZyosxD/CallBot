import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

export const sendNotificationEmail = async (subject, htmlContent) => {
    try {
        if (!config.email.host || !config.email.user || !config.email.pass) {
            logger.warn('Email config missing, skipping email notification.');
            return;
        }

        let transporter = nodemailer.createTransport({
            host: config.email.host,
            port: config.email.port,
            secure: config.email.secure,
            auth: {
                user: config.email.user,
                pass: config.email.pass,
            },
        });

        let info = await transporter.sendMail({
            from: `"${config.email.fromName}" <${config.email.fromEmail}>`,
            to: config.email.notificationEmail,
            subject: subject,
            html: htmlContent,
        });

        logger.info(`Message sent: ${info.messageId}`);
    } catch (error) {
        logger.error('Error sending email:', error);
    }
};

export const sendSuccessEmail = async (callerId, contactName, companyName, confirmedPhone, appointmentTime) => {
    const subject = `🟢 SUCCESS: Technical Assessment Scheduled - ${companyName}`;
    const htmlContent = `
        <h2>Assessment Scheduled</h2>
        <p><strong>Contact Name:</strong> ${contactName}</p>
        <p><strong>Company Name:</strong> ${companyName}</p>
        <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
        <br>
        <h3>Phone Comparison</h3>
        <p><strong>Original Caller ID:</strong> ${callerId}</p>
        <p><strong>Confirmed Phone (Verbal):</strong> ${confirmedPhone}</p>
    `;
    await sendNotificationEmail(subject, htmlContent);
};

export const sendReportEmail = async (callerId, reason, notes) => {
    const subject = `🟠 REPORT: Lead Interaction - ${callerId}`;
    const htmlContent = `
        <h2>Lead Interaction Report</h2>
        <p><strong>Caller ID:</strong> ${callerId}</p>
        <p><strong>Reason:</strong> ${reason}</p>
        <p><strong>Notes:</strong> ${notes}</p>
    `;
    await sendNotificationEmail(subject, htmlContent);
};
