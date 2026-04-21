import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter = null;

if (config.email.user && config.email.pass) {
    transporter = nodemailer.createTransport({
        host: config.email.host,
        port: config.email.port,
        secure: config.email.port === 465, // true for 465, false for other ports
        auth: {
            user: config.email.user,
            pass: config.email.pass,
        },
    });
} else {
    logger.warn('SMTP credentials not configured. Emails will not be sent.');
}

export const sendReportEmail = async ({ type, callerId, confirmedPhone, data }) => {
    if (!transporter) {
        logger.warn('Email transporter not initialized. Skipping email send.');
        return;
    }

    if (!config.email.to) {
         logger.warn('REPORT_EMAIL_TO not configured. Skipping email send.');
         return;
    }

    try {
        let subject = '';
        let htmlBody = '';

        if (type === 'SUCCESS') {
            subject = `🟢 SUCCESS: Technical Assessment Scheduled - ${data.companyName || 'Unknown Company'}`;
            htmlBody = `
                <h2>Technical Assessment Scheduled</h2>
                <p><strong>Contact Name:</strong> ${data.contactName}</p>
                <p><strong>Company Name:</strong> ${data.companyName}</p>
                <p><strong>Appointment Time:</strong> ${data.appointmentTime}</p>
                <hr/>
                <h3>Phone Number Verification</h3>
                <p><strong>Twilio Caller ID:</strong> ${callerId}</p>
                <p><strong>Verbally Confirmed Phone:</strong> ${confirmedPhone}</p>
                <p><em>Note: If these numbers differ, the confirmed phone is likely a direct line or mobile.</em></p>
            `;
        } else if (type === 'REPORT') {
            subject = `🟠 REPORT: Interaction Logged - Caller ${callerId}`;
            htmlBody = `
                <h2>Interaction Report</h2>
                <p><strong>Status/Reason:</strong> ${data.reason || 'Not interested / Voicemail / Call back later'}</p>
                <hr/>
                <h3>Phone Information</h3>
                <p><strong>Twilio Caller ID:</strong> ${callerId}</p>
                <p><strong>Any Confirmed Phone:</strong> ${confirmedPhone || 'N/A'}</p>
                <br/>
                <p><strong>Additional Notes:</strong> ${data.notes || 'None'}</p>
            `;
        }

        const info = await transporter.sendMail({
            from: config.email.from,
            to: config.email.to,
            subject: subject,
            html: htmlBody,
        });

        logger.info(`Email sent: ${info.messageId}`);
    } catch (error) {
        logger.error('Error sending email:', error);
    }
};
