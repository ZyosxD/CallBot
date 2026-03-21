import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter;

if (config.email.user && config.email.pass) {
    transporter = nodemailer.createTransport({
        host: config.email.host,
        port: config.email.port,
        secure: config.email.port == 465,
        auth: {
            user: config.email.user,
            pass: config.email.pass
        }
    });
} else {
    logger.warn('SMTP credentials not provided. Email notifications will be disabled.');
}

export const sendNotificationEmail = async (subject, text) => {
    if (!transporter) {
        logger.info(`[Email Disabled] ${subject}\n${text}`);
        return;
    }

    try {
        const info = await transporter.sendMail({
            from: `"1Wire Assistant" <${config.email.user}>`,
            to: config.email.to || config.email.user,
            subject: subject,
            text: text,
        });
        logger.info(`Email sent: ${info.messageId}`);
    } catch (error) {
        logger.error('Error sending email:', error);
    }
};
