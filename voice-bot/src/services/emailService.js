import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter;

export const sendEmail = async ({ subject, text }) => {
    try {
        if (!config.email.host || !config.email.user || !config.email.pass) {
            logger.warn('Email configuration missing. Skipping email send.');
            return;
        }

        if (!transporter) {
            transporter = nodemailer.createTransport({
                host: config.email.host,
                port: config.email.port,
                secure: false, // true for 465, false for other ports
                auth: {
                    user: config.email.user,
                    pass: config.email.pass
                }
            });
        }

        const info = await transporter.sendMail({
            from: config.email.from,
            to: config.email.to,
            subject: subject,
            text: text
        });

        logger.info(`Email sent: ${info.messageId}`);
    } catch (error) {
        logger.error('Error sending email:', error);
    }
};
