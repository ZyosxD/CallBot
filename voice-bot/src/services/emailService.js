import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter = null;

const createTransporter = () => {
    if (!config.smtp.host || !config.smtp.user) {
        logger.warn('SMTP configuration missing. Email service disabled.');
        return null;
    }

    return nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465, // true for 465, false for other ports
        auth: {
            user: config.smtp.user,
            pass: config.smtp.pass,
        },
    });
};

export const sendEmail = async (subject, htmlBody) => {
    try {
        if (!transporter) {
            transporter = createTransporter();
        }

        if (!transporter) {
            logger.warn('Email skipped due to missing configuration');
            return;
        }

        const mailOptions = {
            from: `"Sarah - 1Wire Assistant" <${config.smtp.user}>`,
            to: config.email.notificationEmail,
            subject: subject,
            html: htmlBody,
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info(`Email sent: ${info.messageId}`);
        return info;

    } catch (error) {
        logger.error('Error sending email:', error);
        throw error;
    }
};

export const sendLeadNotification = async (lead) => {
    const subject = `🟢 New Lead: ${lead.name} - ${lead.company}`;
    const body = `
        <h1>New Technical Assessment Scheduled!</h1>
        <p><strong>Name:</strong> ${lead.name}</p>
        <p><strong>Company:</strong> ${lead.company}</p>
        <p><strong>Phone:</strong> ${lead.phone}</p>
        <p><strong>Caller ID:</strong> ${lead.callerId || 'N/A'}</p>
        <p><strong>Confirmed Time:</strong> ${lead.appointmentTime}</p>
        <hr>
        <p><em>Great job, Sarah!</em></p>
    `;
    return sendEmail(subject, body);
};

export const sendInteractionReport = async (interaction) => {
    const subject = `🟠 Interaction Report: ${interaction.name || 'Unknown'}`;
    const body = `
        <h1>Interaction Report</h1>
        <p><strong>Name:</strong> ${interaction.name || 'Unknown'}</p>
        <p><strong>Company:</strong> ${interaction.company || 'Unknown'}</p>
        <p><strong>Phone:</strong> ${interaction.phone || 'N/A'}</p>
        <p><strong>Outcome:</strong> ${interaction.outcome}</p>
        <p><strong>Notes:</strong> ${interaction.notes || 'No notes'}</p>
        <hr>
        <p><em>Follow up may be required.</em></p>
    `;
    return sendEmail(subject, body);
};
