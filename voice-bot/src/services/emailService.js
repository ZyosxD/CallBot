import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false, // true for 465, false for other ports
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    });
  }

  async sendEmail(subject, htmlContent) {
    if (!config.notificationEmail) {
      logger.warn('No notification email configured. Email not sent.');
      return;
    }

    try {
      const info = await this.transporter.sendMail({
        from: `"Sarah (1Wire AI)" <${config.smtp.user}>`,
        to: config.notificationEmail,
        subject: subject,
        html: htmlContent,
      });
      logger.info(`Email sent: ${info.messageId}`);
    } catch (error) {
      logger.error('Error sending email:', error);
    }
  }

  async sendSuccessEmail(data) {
    const { name, company, confirmedPhone, callerId, date, notes } = data;
    const subject = `🟢 New Appointment Scheduled: ${company} - ${name}`;

    const htmlContent = `
      <h2>New Technical Assessment Scheduled</h2>
      <p><strong>Contact Name:</strong> ${name}</p>
      <p><strong>Company:</strong> ${company}</p>
      <p><strong>Appointment Time:</strong> ${date}</p>
      <hr>
      <h3>Phone Verification</h3>
      <p><strong>Caller ID (Twilio):</strong> ${callerId}</p>
      <p><strong>Confirmed Phone:</strong> ${confirmedPhone}</p>
      <p><em>${callerId === confirmedPhone ? '✅ Match' : '⚠️ Mismatch'}</em></p>
      <hr>
      <h3>Notes</h3>
      <p>${notes || 'No additional notes.'}</p>
    `;

    await this.sendEmail(subject, htmlContent);
  }

  async sendReportEmail(data) {
    const { status, reason, callerId, notes } = data;
    const subject = `🟠 Interaction Report: ${callerId} - ${status}`;

    const htmlContent = `
      <h2>Call Interaction Report</h2>
      <p><strong>Status:</strong> ${status}</p>
      <p><strong>Reason/Outcome:</strong> ${reason}</p>
      <p><strong>Caller ID:</strong> ${callerId}</p>
      <hr>
      <h3>Notes</h3>
      <p>${notes || 'No additional notes.'}</p>
    `;

    await this.sendEmail(subject, htmlContent);
  }
}

export const emailService = new EmailService();
