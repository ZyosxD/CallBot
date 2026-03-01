import winston from 'winston';
import path from 'path';

const logFormat = winston.format.printf((info) => {
  return `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`;
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    logFormat
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.File({ filename: 'error.log', level: 'error' })
  ]
});

export const logConversation = (conversationId, role, content) => {
  logger.info(`Conversation [${conversationId}] ${role}: ${content}`);
};

export default logger;
