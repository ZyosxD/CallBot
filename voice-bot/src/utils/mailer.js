import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from './logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.smtp.host,
  port: config.email.smtp.port,
  secure: config.email.smtp.port === 465, // true for 465, false for other ports
  auth: {
    user: config.email.smtp.user,
    pass: config.email.smtp.pass,
  },
});

export const sendEmail = async (subject, htmlContent) => {
  try {
    const info = await transporter.sendMail({
      from: config.email.from, // sender address
      to: config.email.notificationEmail, // list of receivers
      subject: subject, // Subject line
      html: htmlContent, // html body
    });
    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};

export const sendSuccessEmail = async (details) => {
    const subject = `🟢 CITA AGENDADA - ${details.companyName}`;
    const html = `
        <h1>✅ Nueva Cita Agendada</h1>
        <p><strong>Cliente:</strong> ${details.companyName}</p>
        <p><strong>Contacto:</strong> ${details.contactName}</p>
        <p><strong>Teléfono (Verbal):</strong> ${details.confirmedPhone}</p>
        <p><strong>CallerID Twilio:</strong> ${details.callerId}</p>
        <p><strong>Fecha/Hora Cita:</strong> ${details.appointmentTime}</p>
        <p><strong>Notas:</strong> ${details.notes || 'N/A'}</p>
    `;
    await sendEmail(subject, html);
};

export const sendReportEmail = async (details) => {
    const subject = `🟠 REPORTE INTERACCIÓN - ${details.phone}`;
    const html = `
        <h1>⚠️ Reporte de Interacción</h1>
        <p><strong>Teléfono:</strong> ${details.phone}</p>
        <p><strong>Resultado:</strong> ${details.outcome}</p>
        <p><strong>Notas:</strong> ${details.notes || 'N/A'}</p>
    `;
    await sendEmail(subject, html);
};
