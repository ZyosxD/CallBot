import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.port == 465, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendLeadEmail = async (leadData, originalCallerId) => {
  try {
    const subject = `🟢 NEW LEAD: ${leadData.companyName} - ${leadData.contactName}`;
    const html = `
      <h2>New Technical Assessment Scheduled</h2>
      <table border="1" cellpadding="5" cellspacing="0">
        <tr>
          <td><strong>Contact Name</strong></td>
          <td>${leadData.contactName}</td>
        </tr>
        <tr>
          <td><strong>Company Name</strong></td>
          <td>${leadData.companyName}</td>
        </tr>
        <tr>
          <td><strong>Confirmed Phone (Verbal)</strong></td>
          <td>${leadData.phone}</td>
        </tr>
        <tr>
          <td><strong>Caller ID (Twilio)</strong></td>
          <td>${originalCallerId}</td>
        </tr>
        <tr>
          <td><strong>Appointment Time</strong></td>
          <td>${leadData.appointmentTime}</td>
        </tr>
        <tr>
          <td><strong>Notes/Needs</strong></td>
          <td>${leadData.notes || 'N/A'}</td>
        </tr>
      </table>
    `;

    await transporter.sendMail({
      from: `"Sarah AI" <${config.email.user}>`,
      to: config.email.notificationEmail,
      subject,
      html,
    });
    logger.info(`Lead email sent for ${leadData.companyName}`);
  } catch (error) {
    logger.error('Error sending lead email:', error);
  }
};

export const sendReportEmail = async (interactionData, originalCallerId) => {
  try {
    const subject = `🟠 CALL REPORT: ${interactionData.status} - ${originalCallerId}`;
    const html = `
      <h2>Call Interaction Report</h2>
      <table border="1" cellpadding="5" cellspacing="0">
        <tr>
          <td><strong>Status</strong></td>
          <td>${interactionData.status}</td>
        </tr>
        <tr>
          <td><strong>Caller ID</strong></td>
          <td>${originalCallerId}</td>
        </tr>
        <tr>
          <td><strong>Summary</strong></td>
          <td>${interactionData.summary || 'N/A'}</td>
        </tr>
      </table>
    `;

    await transporter.sendMail({
      from: `"Sarah AI" <${config.email.user}>`,
      to: config.email.notificationEmail,
      subject,
      html,
    });
    logger.info(`Report email sent for ${originalCallerId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
