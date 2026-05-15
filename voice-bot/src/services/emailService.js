import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.port === '465', // true for 465, false for other ports
    auth: {
        user: config.email.user,
        pass: config.email.pass
    }
});

export const sendSuccessEmail = async (appointmentData) => {
    try {
        const mailOptions = {
            from: config.email.from,
            to: config.email.to,
            subject: '🟢 SUCCESS: New Technical Assessment Scheduled!',
            text: `A new Technical Assessment has been scheduled!

Contact Name: ${appointmentData.contactName}
Company Name: ${appointmentData.companyName}

Original Caller ID: ${appointmentData.originalCallerId}
Verbally Confirmed Phone: ${appointmentData.verifiedPhone}

Appointment Time: ${appointmentData.exactTime}
Call SID: ${appointmentData.callSid}
`
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info(`Success Email sent: ${info.messageId}`);
    } catch (error) {
        logger.error('Error sending success email:', error);
    }
};

export const sendReportEmail = async (interactionData) => {
    try {
        const mailOptions = {
            from: config.email.from,
            to: config.email.to,
            subject: '🟠 REPORT: Interaction Logged',
            text: `An interaction was logged but did not result in an appointment.

Reason: ${interactionData.reason}
Details: ${interactionData.details || 'N/A'}

Original Caller ID: ${interactionData.originalCallerId}
Call SID: ${interactionData.callSid}
`
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info(`Report Email sent: ${info.messageId}`);
    } catch (error) {
        logger.error('Error sending report email:', error);
    }
};
