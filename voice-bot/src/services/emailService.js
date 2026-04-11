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

export const sendSuccessEmail = async (contactName, companyName, confirmedPhone, callerId, appointmentTime) => {
    try {
        const mailOptions = {
            from: config.email.user,
            to: config.email.to,
            subject: `🟢 SUCCESS: Technical Assessment Scheduled - ${companyName}`,
            text: `
A new Technical Assessment has been scheduled!

Details:
- Contact Name: ${contactName}
- Company Name: ${companyName}
- Appointment Time: ${appointmentTime}
- Confirmed Phone (Verbal): ${confirmedPhone}
- Twilio Caller ID: ${callerId}

Great job Sarah!
            `
        };

        if(config.email.user && config.email.pass) {
            await transporter.sendMail(mailOptions);
            logger.info(`Success email sent for ${companyName}`);
        } else {
            logger.warn(`Email not sent: SMTP credentials not fully configured. Email content: \n${mailOptions.text}`);
        }
    } catch (error) {
        logger.error(`Error sending success email: ${error.message}`);
    }
};

export const sendReportEmail = async (reason, callerId) => {
    try {
        const mailOptions = {
            from: config.email.user,
            to: config.email.to,
            subject: `🟠 REPORT: Interaction Ended - ${reason}`,
            text: `
An interaction was completed without scheduling an assessment.

Reason: ${reason}
Twilio Caller ID: ${callerId}
            `
        };

        if(config.email.user && config.email.pass) {
            await transporter.sendMail(mailOptions);
            logger.info(`Report email sent for caller ${callerId}`);
        } else {
            logger.warn(`Email not sent: SMTP credentials not fully configured. Email content: \n${mailOptions.text}`);
        }
    } catch (error) {
        logger.error(`Error sending report email: ${error.message}`);
    }
};
