import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter = null;

if (config.email.smtpUser && config.email.smtpPass) {
    transporter = nodemailer.createTransport({
        host: config.email.smtpHost,
        port: config.email.smtpPort,
        secure: config.email.smtpPort == 465, // true for 465, false for other ports
        auth: {
            user: config.email.smtpUser,
            pass: config.email.smtpPass,
        },
    });
} else {
    logger.warn('SMTP Credentials not configured. Emails will only be logged.');
}

export const sendEmail = async (subject, htmlContent) => {
    try {
        if (!config.email.notifyEmail) {
            logger.warn('No NOTIFY_EMAIL configured. Skipping email send.');
            return;
        }

        if (transporter) {
            const info = await transporter.sendMail({
                from: `"Sarah - 1Wire Bot" <${config.email.smtpUser}>`,
                to: config.email.notifyEmail,
                subject: subject,
                html: htmlContent,
            });
            logger.info(`Email sent successfully: ${info.messageId}`);
        } else {
            logger.info(`[MOCK EMAIL] Subject: ${subject}\nHTML: ${htmlContent}`);
        }
    } catch (error) {
        logger.error('Failed to send email:', error);
    }
};
