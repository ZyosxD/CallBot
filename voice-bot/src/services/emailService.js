import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';
import dotenv from 'dotenv';
dotenv.config();

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

export const sendSuccessEmail = async (lead) => {
    try {
        const mailOptions = {
            from: process.env.SMTP_USER,
            to: process.env.NOTIFICATION_EMAIL || process.env.SMTP_USER,
            subject: \`🟢 Success: Appointment Scheduled with ${lead.companyName}\`,
            html: \`
                <h2>🎉 New Appointment Scheduled!</h2>
                <p><strong>Contact Name:</strong> ${lead.contactName}</p>
                <p><strong>Company:</strong> ${lead.companyName}</p>
                <p><strong>Appointment Time:</strong> ${lead.appointmentTime}</p>
                <hr/>
                <p><strong>Verified Phone:</strong> ${lead.confirmedPhone}</p>
                <p><strong>Original Caller ID:</strong> ${lead.callerId}</p>
                <p><em>(Match: ${lead.confirmedPhone === lead.callerId ? 'Yes' : 'No'})</em></p>
                <hr/>
                <p><strong>Call SID:</strong> ${lead.callSid}</p>
            \`
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info(\`Success email sent: ${info.messageId}\`);
    } catch (error) {
        logger.error(\`Failed to send success email: ${error.message}\`);
    }
};

export const sendReportEmail = async (interaction) => {
    try {
        const mailOptions = {
            from: process.env.SMTP_USER,
            to: process.env.NOTIFICATION_EMAIL || process.env.SMTP_USER,
            subject: \`🟠 Report: Interaction with ${interaction.callerId}\`,
            html: \`
                <h2>📋 Interaction Report</h2>
                <p><strong>Reason:</strong> ${interaction.reason}</p>
                <p><strong>Notes:</strong> ${interaction.notes || 'None'}</p>
                <hr/>
                <p><strong>Original Caller ID:</strong> ${interaction.callerId}</p>
                <hr/>
                <p><strong>Call SID:</strong> ${interaction.callSid}</p>
            \`
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info(\`Report email sent: ${info.messageId}\`);
    } catch (error) {
        logger.error(\`Failed to send report email: ${error.message}\`);
    }
};
