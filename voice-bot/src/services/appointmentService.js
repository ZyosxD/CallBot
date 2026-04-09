import dayjs from 'dayjs';
import logger from '../utils/logger.js';

// Simple in-memory storage for appointments (mock database)
const appointments = [];

export const createAppointment = async (data) => {
  try {
    const { name, date, time } = data;

    // Basic validation
    if (!name || !date || !time) {
      throw new Error('Missing required appointment details');
    }

    // Mock saving appointment
    const appointment = {
      id: Date.now(),
      name,
      date,
      time,
      status: 'confirmed'
    };

    appointments.push(appointment);
    logger.info(`Appointment created for ${name} on ${date} at ${time}`);

    return {
      success: true,
      message: `Appointment confirmed for ${name} on ${date} at ${time}.`,
      appointment
    };

  } catch (error) {
    logger.error('Error creating appointment:', error);
    return {
      success: false,
      message: 'Failed to create appointment.'
    };
  }
};

export const checkAvailability = async (date, time) => {
    // Mock availability check
    const exists = appointments.find(a => a.date === date && a.time === time);
    return !exists;
};
