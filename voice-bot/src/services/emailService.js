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

export const sendEmail = async (subject, htmlContent) => {
    try {
        if (!config.email.host) {
            logger.warn('Email configuration missing, skipping email send.');
            return;
        }

        const info = await transporter.sendMail({
            from: config.email.from,
            to: config.email.to,
            subject: subject,
            html: htmlContent
        });

        logger.info(`Email sent: ${info.messageId}`);
    } catch (error) {
        logger.error('Error sending email:', error);
    }
};
