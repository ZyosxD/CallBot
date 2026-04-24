import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsFilePath = path.join(__dirname, '../data/leads.json');
const interactionsFilePath = path.join(__dirname, '../data/interactions.json');

const transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    auth: {
        user: config.email.user,
        pass: config.email.pass
    }
});

const appendData = (filePath, data) => {
    let list = [];
    if (fs.existsSync(filePath)) {
        list = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    list.push({ timestamp: new Date().toISOString(), ...data });
    fs.writeFileSync(filePath, JSON.stringify(list, null, 2));
};

export const appendLead = (data) => appendData(leadsFilePath, data);
export const appendInteraction = (data) => appendData(interactionsFilePath, data);

export const sendEmailReport = async (type, data) => {
    try {
        const isSuccess = type === 'SUCCESS';
        const emoji = isSuccess ? '🟢' : '🟠';
        const subject = `${emoji} ${type} - Call Report - ${data.companyName || data.reason || 'Interaction'}`;

        let text = `Call SID: ${data.callSid}\n`;
        text += `Twilio Caller ID: ${data.callerId}\n`;

        if (data.confirmedPhone) {
            text += `Confirmed Phone: ${data.confirmedPhone}\n`;
            text += `Phone Match: ${data.callerId === data.confirmedPhone ? 'YES' : 'NO'}\n`;
        }

        if (isSuccess) {
            text += `\nAppointment Details:\n`;
            text += `Contact Name: ${data.contactName}\n`;
            text += `Company Name: ${data.companyName}\n`;
            text += `Appointment Time: ${data.appointmentTime}\n`;
        } else {
            text += `\nInteraction Report:\n`;
            text += `Reason: ${data.reason}\n`;
            if (data.notes) text += `Notes: ${data.notes}\n`;
        }

        await transporter.sendMail({
            from: config.email.user,
            to: config.email.to,
            subject: subject,
            text: text
        });

        logger.info(`Email report sent successfully. Type: ${type}`);
    } catch (error) {
        logger.error('Error sending email report:', error);
    }
};
