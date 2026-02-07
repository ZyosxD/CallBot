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

export const sendSuccessEmail = async (data) => {
  try {
    const { name, company, phone, time, callerId } = data;

    const mailOptions = {
      from: config.email.user,
      to: config.email.user, // Sending to self/admin
      subject: `✅ NEW APPOINTMENT: ${company} - ${name}`,
      html: `
        <div style="background-color: #d4edda; padding: 20px; border-radius: 5px;">
          <h2 style="color: #155724;">New Technical Assessment Scheduled!</h2>
          <p><strong>Contact Name:</strong> ${name}</p>
          <p><strong>Company:</strong> ${company}</p>
          <p><strong>Confirmed Phone:</strong> ${phone}</p>
          <p><strong>Twilio CallerID:</strong> ${callerId || 'N/A'}</p>
          <p><strong>Requested Time:</strong> ${time}</p>
          <hr>
          <p><em>Great job, Sarah!</em></p>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Success email sent: ${info.messageId}`);
    return true;
  } catch (error) {
    logger.error('Error sending success email:', error);
    return false;
  }
};

export const sendReportEmail = async (data) => {
  try {
    const { phone, status, reason, transcript, callerId } = data;

    const mailOptions = {
      from: config.email.user,
      to: config.email.user,
      subject: `🟧 CALL REPORT: ${status} - ${phone}`,
      html: `
        <div style="background-color: #fff3cd; padding: 20px; border-radius: 5px;">
          <h2 style="color: #856404;">Call Interaction Report</h2>
          <p><strong>Phone:</strong> ${phone}</p>
          <p><strong>Twilio CallerID:</strong> ${callerId || 'N/A'}</p>
          <p><strong>Status:</strong> ${status}</p>
          <p><strong>Reason/Notes:</strong> ${reason}</p>
          <hr>
          <h3>Transcript/Summary:</h3>
          <p>${transcript || 'No transcript available.'}</p>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Report email sent: ${info.messageId}`);
    return true;
  } catch (error) {
    logger.error('Error sending report email:', error);
    return false;
  }
};
