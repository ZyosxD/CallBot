import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: false, // true for 465, false for other ports
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

export const sendSuccessEmail = async (data, clientId) => {
  const { contactName, companyName, phone, dateTime, notes } = data;

  const subject = `✅ Nueva Cita Confirmada: ${companyName}`;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #333;">
      <h2 style="color: #2e7d32;">✅ Cita Agendada con Éxito</h2>
      <p><strong>Cliente ID:</strong> ${clientId || 'N/A'}</p>
      <hr>
      <h3>Detalles del Contacto</h3>
      <ul>
        <li><strong>Nombre:</strong> ${contactName}</li>
        <li><strong>Empresa:</strong> ${companyName}</li>
        <li><strong>Teléfono Confirmado:</strong> ${phone}</li>
        <li><strong>Fecha y Hora:</strong> ${dateTime}</li>
      </ul>
      <hr>
      <h3>Necesidades / Notas</h3>
      <p>${notes || 'Ninguna nota adicional.'}</p>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"Sarah AI Assistant" <${config.smtp.user}>`,
      to: config.smtp.notificationEmail,
      subject: subject,
      html: html,
    });
    logger.info(`Success email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (data, clientId, originalPhone) => {
  const { outcome, notes } = data;

  const subject = `⚠️ Reporte de Interacción: ${clientId || originalPhone}`;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #333;">
      <h2 style="color: #ef6c00;">⚠️ Reporte de Interacción</h2>
      <p><strong>Cliente ID:</strong> ${clientId || 'N/A'}</p>
      <p><strong>Teléfono Original (Twilio CallerID):</strong> ${originalPhone || 'N/A'}</p>
      <hr>
      <h3>Resultado</h3>
      <p><strong>Outcome:</strong> ${outcome}</p>
      <hr>
      <h3>Detalles / Notas</h3>
      <p>${notes || 'Sin detalles adicionales.'}</p>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"Sarah AI Assistant" <${config.smtp.user}>`,
      to: config.smtp.notificationEmail,
      subject: subject,
      html: html,
    });
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
