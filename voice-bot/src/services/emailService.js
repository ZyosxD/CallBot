import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter = null;

if (config.email.host && config.email.user && config.email.pass) {
    transporter = nodemailer.createTransport({
        host: config.email.host,
        port: config.email.port,
        secure: config.email.port === 465, // true for 465, false for other ports
        auth: {
            user: config.email.user,
            pass: config.email.pass,
        },
    });
}

export const sendEmail = async ({ subject, text }) => {
    if (!transporter) {
        logger.warn('Email service is not configured. Skipping email send.');
        return;
    }

    try {
        const info = await transporter.sendMail({
            from: config.email.from,
            to: config.email.to,
            subject: subject,
            text: text,
        });

        logger.info(`Email sent: ${info.messageId}`);
    } catch (error) {
        logger.error('Error sending email:', error);
    }
};
