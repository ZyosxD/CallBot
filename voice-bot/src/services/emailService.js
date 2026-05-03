import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

export const sendReportEmail = async (type, details) => {
    try {
        if (!config.email || !config.email.user || !config.email.pass) {
            logger.warn('Email configuration missing, skipping email send.');
            return;
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail', // Assuming gmail as per spec, you can configure host/port in config if needed
            auth: {
                user: config.email.user,
                pass: config.email.pass
            }
        });

        let subject = '';
        let body = '';

        if (type === 'SUCCESS') {
            subject = '🟢 SUCCESS: New Technical Assessment Scheduled';
            body = `
A new Technical Assessment has been scheduled!

Details:
- Contact Name: ${details.contactName}
- Company Name: ${details.companyName}
- Confirmed Phone: ${details.confirmedPhone}
- Twilio CallerID: ${details.callerId}
- Appointment Time: ${details.appointmentTime}

Notes: The client agreed to speak with a human specialist.
            `;
        } else if (type === 'REPORT') {
            subject = '🟠 REPORT: Interaction Logged';
            body = `
An interaction was logged (Not interested / Call back later / Voicemail).

Details:
- Reason: ${details.reason}
- Notes: ${details.notes}
- Twilio CallerID: ${details.callerId}
            `;
        }

        const mailOptions = {
            from: config.email.user,
            to: config.email.user, // Send to self/admin
            subject: subject,
            text: body
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info(`Email sent: ${info.messageId}`);
    } catch (error) {
        logger.error('Error sending email:', error);
    }
};
