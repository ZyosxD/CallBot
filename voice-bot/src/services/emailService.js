import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const createTransporter = () => {
    return nodemailer.createTransport({
        host: config.email.smtpHost,
        port: config.email.smtpPort,
        secure: false,
        auth: {
            user: config.email.smtpUser,
            pass: config.email.smtpPass
        }
    });
};

export const sendSuccessEmail = async (leadData) => {
    try {
        const transporter = createTransporter();
        const mailOptions = {
            from: config.email.smtpUser,
            to: config.email.notificationEmail || config.email.smtpUser,
            subject: `🟢 SUCCESS: Technical Assessment Scheduled - ${leadData.companyName}`,
            text: `
We have successfully scheduled a new Technical Assessment!

Contact Details:
- Name: ${leadData.contactName}
- Company: ${leadData.companyName}
- Appointment Time: ${leadData.appointmentTime}

Phone Verification:
- Original Caller ID (Twilio): ${leadData.callerId}
- Verbally Confirmed Phone: ${leadData.confirmedPhone}
            `
        };

        await transporter.sendMail(mailOptions);
        logger.info(`Success email sent for lead ${leadData.companyName}`);
    } catch (error) {
        logger.error('Error sending success email:', error);
    }
};

export const sendReportEmail = async (interactionData) => {
    try {
        const transporter = createTransporter();
        const mailOptions = {
            from: config.email.smtpUser,
            to: config.email.notificationEmail || config.email.smtpUser,
            subject: `🟠 REPORT: Call Outcome - ${interactionData.callerId}`,
            text: `
An interaction was completed without scheduling an appointment.

Details:
- Original Caller ID (Twilio): ${interactionData.callerId}
- Reason/Outcome: ${interactionData.reason}
            `
        };

        await transporter.sendMail(mailOptions);
        logger.info(`Report email sent for caller ${interactionData.callerId}`);
    } catch (error) {
        logger.error('Error sending report email:', error);
    }
};
