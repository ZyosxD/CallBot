import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
    service: config.email.service,
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: {
        user: config.email.auth.user,
        pass: config.email.auth.pass
    }
});

const sendEmail = async (subject, html) => {
    try {
        await transporter.sendMail({
            from: `"1Wire Sarah" <${config.email.auth.user}>`,
            to: config.email.to,
            subject,
            html
        });
        logger.info(`Email sent: ${subject}`);
    } catch (error) {
        logger.error(`Failed to send email (${subject}):`, error);
    }
};

export const sendSuccessEmail = async (leadData, originalCallerId) => {
    const subject = `🟢 SUCCESS: Technical Assessment Scheduled - ${leadData.companyName}`;
    const html = `
        <h2>Technical Assessment Scheduled!</h2>
        <p><strong>Company:</strong> ${leadData.companyName}</p>
        <p><strong>Contact:</strong> ${leadData.contactName}</p>
        <p><strong>Time:</strong> ${leadData.appointmentTime}</p>
        <br/>
        <h3>Phone Comparison</h3>
        <p><strong>Original Caller ID:</strong> ${originalCallerId}</p>
        <p><strong>Verbal Confirmation:</strong> ${leadData.confirmedPhone}</p>
        <p><em>Check if they provided a direct or cell line!</em></p>
    `;
    await sendEmail(subject, html);
};

export const sendReportEmail = async (interactionData, originalCallerId) => {
    const subject = `🟠 REPORT: Interaction Logged - ${originalCallerId}`;
    const html = `
        <h2>Interaction Report</h2>
        <p><strong>Caller ID:</strong> ${originalCallerId}</p>
        <p><strong>Reason:</strong> ${interactionData.reason}</p>
        <p><strong>Details:</strong> ${interactionData.details || 'N/A'}</p>
    `;
    await sendEmail(subject, html);
};
