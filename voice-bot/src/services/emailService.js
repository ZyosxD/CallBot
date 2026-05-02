import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: false, // true for 465, false for other ports
    auth: {
        user: config.email.user,
        pass: config.email.pass
    }
});

export const sendSuccessEmail = async (data) => {
    const { contactName, companyName, confirmedPhone, callerId, appointmentTime } = data;
    const subject = `🟢 SUCCESS: Technical Assessment Scheduled - ${companyName}`;

    const html = `
        <h2>New Technical Assessment Scheduled!</h2>
        <p><strong>Company:</strong> ${companyName}</p>
        <p><strong>Contact:</strong> ${contactName}</p>
        <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
        <hr/>
        <h3>Phone Verification</h3>
        <p><strong>Confirmed Phone:</strong> ${confirmedPhone}</p>
        <p><strong>Caller ID:</strong> ${callerId}</p>
        <p><em>(Compare these to ensure we have the best direct line)</em></p>
    `;

    try {
        await transporter.sendMail({
            from: `"1Wire Assistant" <${config.email.user}>`,
            to: config.email.to,
            subject: subject,
            html: html
        });
        logger.info(`Success email sent for ${companyName}`);
    } catch (error) {
        logger.error(`Error sending success email: ${error.message}`);
    }
};

export const sendReportEmail = async (data) => {
    const { reason, callerId, confirmedPhone, notes } = data;
    const subject = `🟠 REPORT: Call Interaction - ${reason}`;

    const html = `
        <h2>Interaction Report</h2>
        <p><strong>Reason:</strong> ${reason}</p>
        <p><strong>Notes:</strong> ${notes || 'No additional notes.'}</p>
        <hr/>
        <h3>Phone Details</h3>
        <p><strong>Caller ID:</strong> ${callerId}</p>
        <p><strong>Confirmed Phone (if any):</strong> ${confirmedPhone || 'N/A'}</p>
    `;

    try {
        await transporter.sendMail({
            from: `"1Wire Assistant" <${config.email.user}>`,
            to: config.email.to,
            subject: subject,
            html: html
        });
        logger.info(`Report email sent for reason: ${reason}`);
    } catch (error) {
        logger.error(`Error sending report email: ${error.message}`);
    }
};
