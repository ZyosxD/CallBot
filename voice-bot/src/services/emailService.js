import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.port == 465,
    auth: {
        user: config.email.user,
        pass: config.email.pass
    }
});

export const sendAppointmentEmail = async (contactName, companyName, confirmedPhone, appointmentTime, callerId) => {
    const subject = `🟢 SUCCESS: Technical Assessment Scheduled - ${companyName}`;
    const text = `
A new Technical Assessment has been scheduled!

Contact Name: ${contactName}
Company Name: ${companyName}
Appointment Time: ${appointmentTime}

Phone Details:
- Verbally Confirmed Phone: ${confirmedPhone}
- Original Caller ID: ${callerId}
    `.trim();

    await sendEmail(subject, text);
};

export const sendReportEmail = async (callerId, reason, notes) => {
    const subject = `🟠 REPORT: Interaction Logged - ${callerId}`;
    const text = `
An interaction was recorded that did not result in an appointment.

Original Caller ID: ${callerId}
Reason: ${reason}
Notes: ${notes}
    `.trim();

    await sendEmail(subject, text);
};

const sendEmail = async (subject, text) => {
    if (!config.email.user || !config.email.to) {
        logger.warn('Email credentials or recipient not configured. Skipping email send.');
        return;
    }

    try {
        const mailOptions = {
            from: `"1Wire Assistant" <${config.email.user}>`,
            to: config.email.to,
            subject: subject,
            text: text
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info(`Email sent: ${info.messageId} - ${subject}`);
    } catch (error) {
        logger.error(`Error sending email: ${error}`);
    }
};
