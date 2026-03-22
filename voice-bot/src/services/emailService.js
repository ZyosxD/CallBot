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

export const sendSuccessEmail = async (lead) => {
    try {
        const mailOptions = {
            from: `"1Wire Assistant" <${config.email.user}>`,
            to: config.email.toEmail,
            subject: '🟢 SUCCESS: New Technical Assessment Scheduled',
            text: `
New Technical Assessment Scheduled!

Contact Name: ${lead.contactName}
Company Name: ${lead.companyName}
Appointment Time: ${lead.appointmentTime}

--- Phone Verification ---
Original Caller ID: ${lead.originalCallerId}
Confirmed Phone: ${lead.confirmedPhone}

Mode: ${lead.mode}
Call SID: ${lead.callSid}
Created At: ${lead.createdAt}
            `
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info(`Success email sent: ${info.messageId}`);
    } catch (error) {
        logger.error('Error sending success email:', error);
    }
};

export const sendReportEmail = async (interaction) => {
    try {
        const mailOptions = {
            from: `"1Wire Assistant" <${config.email.user}>`,
            to: config.email.toEmail,
            subject: `🟠 REPORT: Call Interaction - ${interaction.reason}`,
            text: `
Interaction Report

Reason: ${interaction.reason}
Notes: ${interaction.notes || 'N/A'}

Caller ID: ${interaction.callerId}
Mode: ${interaction.mode}
Call SID: ${interaction.callSid}
Created At: ${interaction.createdAt}
            `
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info(`Report email sent: ${info.messageId}`);
    } catch (error) {
        logger.error('Error sending report email:', error);
    }
};
