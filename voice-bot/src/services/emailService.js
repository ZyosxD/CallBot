import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter = null;

if (config.email.host && config.email.user) {
    transporter = nodemailer.createTransport({
        host: config.email.host,
        port: config.email.port,
        secure: config.email.secure,
        auth: {
            user: config.email.user,
            pass: config.email.pass
        }
    });
}

export const sendSuccessEmail = async (leadData, callerId) => {
    if (!transporter) {
        logger.warn('Email transporter not configured. Skipping success email.');
        return;
    }

    try {
        const mailOptions = {
            from: config.email.from,
            to: config.email.to,
            subject: `🟢 SUCCESS - Technical Assessment Scheduled - ${leadData.companyName}`,
            text: `
Hello Team,

Sarah has successfully scheduled a new Technical Assessment!

DETAILS:
-----------------------------------------
Company Name: ${leadData.companyName}
Contact Name: ${leadData.contactName}
Confirmed Phone: ${leadData.confirmedPhone}
Caller ID (Twilio): ${callerId}
Appointment Time: ${leadData.appointmentTime}
-----------------------------------------

Action Required:
Please ensure a specialist is available to handle this assessment.

Best,
1Wire Assistant (Sarah)
            `
        };

        await transporter.sendMail(mailOptions);
        logger.info('Success email sent.');
    } catch (error) {
        logger.error('Failed to send success email:', error);
    }
};

export const sendReportEmail = async (interactionData, callerId) => {
    if (!transporter) {
        logger.warn('Email transporter not configured. Skipping report email.');
        return;
    }

    try {
        const mailOptions = {
            from: config.email.from,
            to: config.email.to,
            subject: `🟠 REPORT - Interaction Log - ${callerId}`,
            text: `
Hello Team,

An interaction was logged that did not result in an appointment.

DETAILS:
-----------------------------------------
Caller ID (Twilio): ${callerId}
Reason/Outcome: ${interactionData.reason}
Notes: ${interactionData.notes}
-----------------------------------------

Best,
1Wire Assistant (Sarah)
            `
        };

        await transporter.sendMail(mailOptions);
        logger.info('Report email sent.');
    } catch (error) {
        logger.error('Failed to send report email:', error);
    }
};
