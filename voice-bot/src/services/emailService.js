import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  service: config.email.service,
  auth: {
    user: config.email.user,
    pass: config.email.pass
  }
});

export const sendLeadNotification = async (leadData) => {
  try {
    const subject = `🟢 New Lead: ${leadData.name || 'Unknown'} - ${leadData.company || 'Unknown Company'}`;
    const text = `
      NEW LEAD GENERATED!

      Name: ${leadData.name}
      Company: ${leadData.company}
      Phone (Confirmed): ${leadData.phone}
      Twilio CallerID: ${leadData.callerId || 'N/A'}
      Requested Time: ${leadData.appointmentTime}

      Notes:
      ${leadData.notes || 'No specific notes.'}
    `;

    await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject,
      text
    });
    logger.info(`Lead notification email sent for ${leadData.name}`);
  } catch (error) {
    logger.error('Error sending lead email:', error);
  }
};

export const sendInteractionReport = async (reportData) => {
  try {
    const subject = `🟠 Interaction Report: ${reportData.phone}`;
    const text = `
      INTERACTION REPORT

      Phone: ${reportData.phone}
      Outcome: ${reportData.outcome}
      Summary: ${reportData.summary}

      Timestamp: ${new Date().toLocaleString()}
    `;

    await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject,
      text
    });
    logger.info(`Interaction report email sent for ${reportData.phone}`);
  } catch (error) {
    logger.error('Error sending interaction report email:', error);
  }
};
