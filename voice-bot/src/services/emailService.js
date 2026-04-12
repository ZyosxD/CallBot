import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter = null;

function getTransporter() {
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: config.email.host,
            port: config.email.port,
            secure: false, // true for 465, false for other ports
            auth: {
                user: config.email.user,
                pass: config.email.pass,
            },
        });
    }
    return transporter;
}

export async function sendSuccessEmail(lead, originalCallerId) {
    try {
        const mailOptions = {
            from: config.email.from,
            to: config.email.to,
            subject: `🟢 SUCCESS: New Technical Assessment Scheduled - ${lead.companyName}`,
            text: `
A new Technical Assessment has been successfully scheduled!

Details:
Contact Name: ${lead.contactName}
Company Name: ${lead.companyName}
Requested Time: ${lead.appointmentTime}

Phone Verification:
Original Caller ID: ${originalCallerId}
Verbally Confirmed Phone: ${lead.confirmedPhone}
${originalCallerId === lead.confirmedPhone ? '(Matches Caller ID)' : '(Different from Caller ID)'}

Call Sid: ${lead.callSid}
Timestamp: ${lead.timestamp}
            `,
        };

        const info = await getTransporter().sendMail(mailOptions);
        logger.info('Success email sent: ' + info.messageId);
    } catch (error) {
        logger.error('Error sending success email:', error);
    }
}

export async function sendReportEmail(interaction, originalCallerId) {
    try {
        const mailOptions = {
            from: config.email.from,
            to: config.email.to,
            subject: `🟠 REPORT: Lead Interaction - ${interaction.reason}`,
            text: `
An interaction has been logged.

Details:
Reason: ${interaction.reason}
Additional Details: ${interaction.details || 'N/A'}

Phone Identification:
Caller ID: ${originalCallerId}

Call Sid: ${interaction.callSid}
Timestamp: ${interaction.timestamp}
            `,
        };

        const info = await getTransporter().sendMail(mailOptions);
        logger.info('Report email sent: ' + info.messageId);
    } catch (error) {
        logger.error('Error sending report email:', error);
    }
}
