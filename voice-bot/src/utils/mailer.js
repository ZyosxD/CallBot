import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from './logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.port == 465, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendSuccessEmail = async (data) => {
  try {
    const { name, company, phone, confirmedPhone, appointmentTime, notes } = data;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; padding: 20px; border: 2px solid #28a745; border-radius: 10px;">
        <h2 style="color: #28a745;">✅ New Appointment Scheduled!</h2>
        <p><strong>Contact Name:</strong> ${name}</p>
        <p><strong>Company:</strong> ${company}</p>
        <p><strong>Caller ID:</strong> ${phone}</p>
        <p><strong>Confirmed Phone:</strong> ${confirmedPhone}</p>
        <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
        <p><strong>Notes:</strong> ${notes || 'N/A'}</p>
      </div>
    `;

    await transporter.sendMail({
      from: `"Sarah Bot" <${config.email.user}>`,
      to: config.email.notificationEmail,
      subject: `✅ APPOINTMENT: ${company} - ${name}`,
      html: htmlContent,
    });

    logger.info(`Success email sent for ${company}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (data) => {
  try {
    const { phone, outcome, notes } = data;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; padding: 20px; border: 2px solid #fd7e14; border-radius: 10px;">
        <h2 style="color: #fd7e14;">⚠️ Interaction Report</h2>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Outcome:</strong> ${outcome}</p>
        <p><strong>Notes:</strong> ${notes || 'N/A'}</p>
      </div>
    `;

    await transporter.sendMail({
      from: `"Sarah Bot" <${config.email.user}>`,
      to: config.email.notificationEmail,
      subject: `⚠️ REPORT: ${outcome} - ${phone}`,
      html: htmlContent,
    });

    logger.info(`Report email sent for ${phone}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
