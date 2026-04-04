import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport(config.email);

export const sendSuccessEmail = async (details, callerId) => {
    const { contactName, companyName, confirmedPhone, appointmentTime } = details;

    const mailOptions = {
        from: config.email.auth.user,
        to: config.email.notificationEmail, // The recipient
        subject: '🟢 SUCCESS: New Technical Assessment Scheduled',
        text: `
We have successfully scheduled a new Technical Assessment!

Details:
- Contact Name: ${contactName}
- Company Name: ${companyName}
- Exact Time: ${appointmentTime}

Phone Verification:
- Twilio Caller ID: ${callerId}
- Confirmed Phone verbally: ${confirmedPhone}
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        logger.info('Success email sent successfully');
    } catch (error) {
        logger.error('Failed to send success email', error);
    }
};

export const sendReportEmail = async (reason, callerId) => {
    const mailOptions = {
        from: config.email.auth.user,
        to: config.email.notificationEmail,
        subject: '🟠 REPORT: Call Interaction Logged',
        text: `
An interaction was logged that did not result in an appointment.

Reason: ${reason}

Phone Information:
- Twilio Caller ID: ${callerId}
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        logger.info('Report email sent successfully');
    } catch (error) {
        logger.error('Failed to send report email', error);
    }
};
