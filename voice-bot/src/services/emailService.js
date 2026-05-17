import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter = null;

const createTransporter = () => {
    if (!transporter) {
        if (!config.email.host || !config.email.user) {
            logger.warn('Email configuration is missing. Emails will not be sent.');
            return null;
        }

        transporter = nodemailer.createTransport({
            host: config.email.host,
            port: parseInt(config.email.port, 10),
            secure: parseInt(config.email.port, 10) === 465,
            auth: {
                user: config.email.user,
                pass: config.email.pass,
            },
        });
    }
    return transporter;
};

export const sendEmail = async ({ to, subject, text, html }) => {
    const t = createTransporter();
    if (!t) return;

    try {
        await t.sendMail({
            from: config.email.from,
            to: to || config.email.to,
            subject,
            text,
            html,
        });
        logger.info(`Email sent successfully: ${subject}`);
    } catch (error) {
        logger.error('Failed to send email:', error);
    }
};

export const sendSuccessEmail = async (appointmentData) => {
    const { contactName, companyName, verifiedPhone, appointmentTime, callerId } = appointmentData;
    const phoneMatch = verifiedPhone === callerId ? 'YES ✅' : 'NO ❌';

    const html = `
        <h2>🟢 SUCCESS: New Technical Assessment Scheduled</h2>
        <p>A new appointment has been confirmed!</p>
        <hr>
        <h3>Appointment Details:</h3>
        <ul>
            <li><strong>Contact Name:</strong> ${contactName}</li>
            <li><strong>Company Name:</strong> ${companyName}</li>
            <li><strong>Appointment Time:</strong> ${appointmentTime}</li>
        </ul>
        <h3>Phone Verification:</h3>
        <ul>
            <li><strong>Twilio Caller ID:</strong> ${callerId}</li>
            <li><strong>Confirmed Phone:</strong> ${verifiedPhone}</li>
            <li><strong>Phones Match:</strong> ${phoneMatch}</li>
        </ul>
    `;

    await sendEmail({
        subject: `🟢 SUCCESS - Appointment with ${companyName}`,
        html,
    });
};

export const sendReportEmail = async (reportData) => {
    const { reason, notes, callerId } = reportData;

    const html = `
        <h2>🟠 REPORT: Call Interaction Logged</h2>
        <p>An interaction was reported and did not result in an appointment.</p>
        <hr>
        <h3>Interaction Details:</h3>
        <ul>
            <li><strong>Twilio Caller ID:</strong> ${callerId}</li>
            <li><strong>Reason:</strong> ${reason}</li>
            <li><strong>Notes:</strong> ${notes || 'No additional notes provided.'}</li>
        </ul>
    `;

    await sendEmail({
        subject: `🟠 REPORT - Interaction (${reason})`,
        html,
    });
};
