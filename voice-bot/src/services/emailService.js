import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: false, // true for 465, false for other ports
    auth: {
        user: config.email.user,
        pass: config.email.pass,
    },
});

export const sendSuccessEmail = async (data, originalCallerId) => {
    try {
        const mailOptions = {
            from: config.email.user,
            to: config.email.to,
            subject: '🟢 SUCCESS: New Technical Assessment Scheduled',
            html: `
                <h3>New Appointment Details</h3>
                <p><strong>Contact Name:</strong> ${data.contactName}</p>
                <p><strong>Company Name:</strong> ${data.companyName}</p>
                <p><strong>Appointment Time:</strong> ${data.appointmentTime}</p>
                <br>
                <h4>Phone Comparison</h4>
                <p><strong>Verbally Confirmed Phone:</strong> ${data.confirmedPhone}</p>
                <p><strong>Original Caller ID:</strong> ${originalCallerId}</p>
                <br>
                <p><strong>Call SID:</strong> ${data.callSid}</p>
                <p><strong>Timestamp:</strong> ${data.timestamp}</p>
            `,
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info('Success email sent: ' + info.messageId);
    } catch (error) {
        logger.error('Error sending success email:', error);
    }
};

export const sendReportEmail = async (data, originalCallerId) => {
    try {
        const mailOptions = {
            from: config.email.user,
            to: config.email.to,
            subject: '🟠 REPORT: Call Interaction Logged',
            html: `
                <h3>Interaction Details</h3>
                <p><strong>Reason:</strong> ${data.reason}</p>
                <p><strong>Notes:</strong> ${data.notes || 'None'}</p>
                <br>
                <h4>Caller Info</h4>
                <p><strong>Original Caller ID:</strong> ${originalCallerId}</p>
                <br>
                <p><strong>Call SID:</strong> ${data.callSid}</p>
                <p><strong>Timestamp:</strong> ${data.timestamp}</p>
            `,
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info('Report email sent: ' + info.messageId);
    } catch (error) {
        logger.error('Error sending report email:', error);
    }
};
