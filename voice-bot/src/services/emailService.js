import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: config.email.user,
        pass: config.email.pass
    }
});

export const sendReportEmail = async (type, details) => {
    try {
        const isSuccess = type === 'success';
        const subject = isSuccess
            ? '🟢 SUCCESS: New Appointment Scheduled!'
            : '🟠 REPORT: Call Interaction Logged';

        const {
            contactName,
            companyName,
            confirmedPhone,
            callerId,
            appointmentTime,
            notes,
            reason
        } = details;

        // Build HTML strictly in English
        let html = `
            <h2>Call Report</h2>
            <p><strong>Status:</strong> ${isSuccess ? 'Success (Appointment Scheduled)' : 'Interaction Recorded'}</p>
            <hr />
            <h3>Contact Information</h3>
            <ul>
                <li><strong>Contact Name:</strong> ${contactName || 'N/A'}</li>
                <li><strong>Company Name:</strong> ${companyName || 'N/A'}</li>
            </ul>
            <h3>Phone Verification</h3>
            <ul>
                <li><strong>Confirmed Phone (Verbal):</strong> ${confirmedPhone || 'N/A'}</li>
                <li><strong>Original Caller ID (Twilio):</strong> ${callerId || 'N/A'}</li>
            </ul>
        `;

        if (isSuccess) {
            html += `
                <h3>Appointment Details</h3>
                <ul>
                    <li><strong>Time:</strong> ${appointmentTime || 'N/A'}</li>
                    <li><strong>Needs/Notes:</strong> ${notes || 'N/A'}</li>
                </ul>
            `;
        } else {
            html += `
                <h3>Interaction Details</h3>
                <ul>
                    <li><strong>Reason:</strong> ${reason || 'N/A'}</li>
                    <li><strong>Notes:</strong> ${notes || 'N/A'}</li>
                </ul>
            `;
        }

        const mailOptions = {
            from: config.email.user,
            to: config.email.notificationEmail,
            subject: subject,
            html: html
        };

        await transporter.sendMail(mailOptions);
        logger.info(`Email sent successfully: ${subject}`);
    } catch (error) {
        logger.error('Error sending email:', error);
    }
};