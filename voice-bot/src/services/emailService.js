import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.port === 465, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.pass
  }
});

export const sendReport = async (type, data, callerId, confirmedPhone) => {
  try {
    const isSuccess = type === 'success';
    const subjectPrefix = isSuccess ? '🟢 SUCCESS' : '🟠 REPORT';
    const subject = `${subjectPrefix}: Call with ${data.name || 'Unknown'}`;

    let htmlContent = `
      <h1>${subject}</h1>
      <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
      <hr>
      <h2>📞 Phone Comparison</h2>
      <ul>
        <li><strong>Twilio Caller ID:</strong> ${callerId || 'N/A'}</li>
        <li><strong>Confirmed Phone:</strong> ${confirmedPhone || 'N/A'} ${callerId === confirmedPhone ? '✅ Match' : '⚠️ Mismatch'}</li>
      </ul>
      <hr>
    `;

    if (isSuccess) {
      htmlContent += `
        <h2>📅 Appointment Details</h2>
        <ul>
          <li><strong>Name:</strong> ${data.name}</li>
          <li><strong>Company:</strong> ${data.company}</li>
          <li><strong>Date:</strong> ${data.date}</li>
          <li><strong>Time:</strong> ${data.time}</li>
          <li><strong>Notes:</strong> ${data.notes || 'None'}</li>
        </ul>
      `;
    } else {
      htmlContent += `
        <h2>📝 Interaction Report</h2>
        <ul>
          <li><strong>Outcome:</strong> ${data.outcome}</li>
          <li><strong>Notes:</strong> ${data.notes || 'None'}</li>
        </ul>
      `;
    }

    if (!config.email.notificationEmail) {
        logger.warn('Notification email not set. Skipping email sending.');
        return;
    }

    await transporter.sendMail({
      from: `"Sarah Bot" <${config.email.user}>`,
      to: config.email.notificationEmail,
      subject: subject,
      html: htmlContent
    });

    logger.info(`Email report sent: ${subject}`);
  } catch (error) {
    logger.error('Error sending email report:', error);
  }
};
