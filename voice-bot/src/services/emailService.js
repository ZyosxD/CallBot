import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter = null;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: config.email.service,
      auth: {
        user: config.email.user,
        pass: config.email.pass
      }
    });
  }
  return transporter;
};

export const sendSuccessEmail = async (lead) => {
  const mailOptions = {
    from: config.email.user,
    to: config.email.to,
    subject: `🟢 SUCCESS: New Technical Assessment - ${lead.companyName}`,
    text: `
New appointment scheduled!

Contact Name: ${lead.contactName}
Company Name: ${lead.companyName}
Appointment Time: ${lead.appointmentTime}

--- Verification ---
Original Twilio Caller ID: ${lead.originalCallerId}
Verbally Confirmed Phone: ${lead.confirmedPhone}
    `
  };

  try {
    const info = await getTransporter().sendMail(mailOptions);
    logger.info('Success email sent: ' + info.response);
  } catch (error) {
    logger.error('Error sending success email: ', error);
  }
};

export const sendReportEmail = async (interaction) => {
  const mailOptions = {
    from: config.email.user,
    to: config.email.to,
    subject: `🟠 REPORT: Interaction Update - ${interaction.reason}`,
    text: `
Interaction logged.

Reason: ${interaction.reason}
Details: ${interaction.details || 'N/A'}

--- Verification ---
Twilio Caller ID: ${interaction.callerId}
    `
  };

  try {
    const info = await getTransporter().sendMail(mailOptions);
    logger.info('Report email sent: ' + info.response);
  } catch (error) {
    logger.error('Error sending report email: ', error);
  }
};
