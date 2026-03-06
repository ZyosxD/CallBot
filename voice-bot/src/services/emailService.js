import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

export const sendReport = async (isSuccess, callerId, confirmedPhone, data) => {
    try {
        if (!config.email.host || !config.email.user || !config.email.pass || !config.email.notificationEmail) {
            logger.warn('Email credentials or notification email are not fully configured. Skipping email report.');
            return;
        }

        const transporter = nodemailer.createTransport({
            host: config.email.host,
            port: config.email.port,
            secure: config.email.port === '465', // true for 465, false for other ports
            auth: {
                user: config.email.user,
                pass: config.email.pass,
            },
        });

        const subject = isSuccess ? '🟢 Success: Technical Assessment Scheduled' : '🟠 Report: Interaction Logged';

        let htmlContent = `<h2>Call Report</h2>`;
        htmlContent += `<p><strong>Twilio Caller ID:</strong> ${callerId}</p>`;
        htmlContent += `<p><strong>Verbally Confirmed Phone:</strong> ${confirmedPhone}</p>`;

        if (callerId !== confirmedPhone && confirmedPhone !== 'N/A') {
             htmlContent += `<p style="color: red;"><strong>Warning:</strong> Confirmed phone number does not match Twilio Caller ID!</p>`;
        }

        htmlContent += `<h3>Details</h3><ul>`;
        for (const [key, value] of Object.entries(data)) {
            htmlContent += `<li><strong>${key}:</strong> ${value}</li>`;
        }
        htmlContent += `</ul>`;

        const mailOptions = {
            from: `"Sarah AI" <${config.email.user}>`,
            to: config.email.notificationEmail,
            subject: subject,
            html: htmlContent,
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info(`Email report sent: ${info.messageId}`);
    } catch (error) {
        logger.error('Error sending email report:', error);
    }
};