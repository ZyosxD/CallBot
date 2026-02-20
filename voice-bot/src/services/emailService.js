import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: false, // true for 465, false for other ports. usually 587 uses STARTTLS
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

export const sendSuccessEmail = async (data) => {
  const { name, company, phone, confirmedPhone, time, needs } = data;

  const html = `
    <div style="font-family: Arial, sans-serif; border: 2px solid #28a745; padding: 20px; border-radius: 10px; max-width: 600px;">
      <h1 style="color: #28a745;">✅ Nueva Cita Agendada</h1>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 5px; font-weight: bold;">Empresa:</td><td style="padding: 5px;">${company}</td></tr>
        <tr><td style="padding: 5px; font-weight: bold;">Contacto:</td><td style="padding: 5px;">${name}</td></tr>
        <tr><td style="padding: 5px; font-weight: bold;">Teléfono (CallerID):</td><td style="padding: 5px;">${phone}</td></tr>
        <tr><td style="padding: 5px; font-weight: bold;">Teléfono Confirmado:</td><td style="padding: 5px;">${confirmedPhone || 'Mismo'}</td></tr>
        <tr><td style="padding: 5px; font-weight: bold;">Hora Cita:</td><td style="padding: 5px;">${time}</td></tr>
      </table>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
      <h3 style="color: #333;">Necesidades Detectadas:</h3>
      <p style="color: #555;">${needs || 'No especificadas'}</p>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"Sarah Bot" <${config.smtp.user}>`,
      to: config.smtp.user, // Sending to self/admin for now
      subject: `✅ Cita: ${company} - ${name}`,
      html: html,
    });
    logger.info(`Success email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (data) => {
  const { company, phone, status, summary } = data;

  const html = `
    <div style="font-family: Arial, sans-serif; border: 2px solid #fd7e14; padding: 20px; border-radius: 10px; max-width: 600px;">
      <h1 style="color: #fd7e14;">⚠️ Reporte de Interacción</h1>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 5px; font-weight: bold;">Empresa:</td><td style="padding: 5px;">${company || 'Desconocida'}</td></tr>
        <tr><td style="padding: 5px; font-weight: bold;">Teléfono:</td><td style="padding: 5px;">${phone}</td></tr>
        <tr><td style="padding: 5px; font-weight: bold;">Estado:</td><td style="padding: 5px;">${status}</td></tr>
      </table>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
      <h3 style="color: #333;">Resumen:</h3>
      <p style="color: #555;">${summary}</p>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"Sarah Bot" <${config.smtp.user}>`,
      to: config.smtp.user,
      subject: `⚠️ Reporte: ${company} - ${status}`,
      html: html,
    });
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
