import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter = null;

const createTransporter = () => {
    if (!transporter && config.email.user && config.email.pass) {
        transporter = nodemailer.createTransport({
            host: config.email.host,
            port: config.email.port,
            secure: config.email.port == 465, // true for 465, false for other ports
            auth: {
                user: config.email.user,
                pass: config.email.pass,
            },
        });
    }
    return transporter;
};

export const sendReportEmail = async (type, data) => {
    const mailTransporter = createTransporter();

    if (!mailTransporter || !config.email.to) {
        logger.warn('Email service not configured. Skipping email report.');
        return;
    }

    let subject = '';
    let html = '';

    if (type === 'SUCCESS') {
        subject = `🟢 SUCCESS: Technical Assessment Scheduled - ${data.companyName}`;
        html = `
            <h2>Technical Assessment Scheduled</h2>
            <p><strong>Contact Name:</strong> ${data.contactName}</p>
            <p><strong>Company Name:</strong> ${data.companyName}</p>
            <p><strong>Confirmed Phone:</strong> ${data.confirmedPhone}</p>
            <p><strong>Caller ID:</strong> ${data.twilioCallerId}</p>
            <p><strong>Appointment Time:</strong> ${data.appointmentTime}</p>
            <p><strong>Call SID:</strong> ${data.callSid}</p>
            <hr>
            <p><em>Check the fiber map and prepare for the call.</em></p>
        `;
    } else if (type === 'REPORT') {
        subject = `🟠 REPORT: Interaction Logged`;
        html = `
            <h2>Interaction Report</h2>
            <p><strong>Reason:</strong> ${data.reason}</p>
            <p><strong>Notes:</strong> ${data.notes || 'N/A'}</p>
            <p><strong>Caller ID:</strong> ${data.twilioCallerId}</p>
            <p><strong>Call SID:</strong> ${data.callSid}</p>
            <hr>
            <p><em>This call did not result in an appointment.</em></p>
        `;
    }

    try {
        const info = await mailTransporter.sendMail({
            from: `"1Wire Assistant" <${config.email.user}>`,
            to: config.email.to,
            subject: subject,
            html: html,
        });
        logger.info(`Email sent: ${info.messageId}`);
    } catch (error) {
        logger.error('Error sending email:', error);
    }
};
