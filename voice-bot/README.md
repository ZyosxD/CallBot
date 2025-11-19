# Voice Bot Project

This project is a voice bot capable of handling phone calls in real-time using Twilio Voice and OpenAI Realtime API.

## Features

- Real-time voice interaction using OpenAI Realtime API.
- Bilingual support (English/Spanish).
- Appointment scheduling.
- FAQ answering.
- Call transfer to human agents.
- Conversation logging.

## Installation

1.  **Clone the repository** (if applicable).
2.  **Install dependencies**:
    ```bash
    cd voice-bot
    npm install
    ```

## Configuration

### Twilio Setup

1.  Create a Twilio account.
2.  Buy a phone number.
3.  Set up a Voice Webhook pointing to your server's public URL (e.g., `https://your-domain.com/voice/inbound`).

### Environment Variables

Create a `.env` file in the root of the `voice-bot` directory with the following variables:

```env
OPENAI_API_KEY=sk-...
PORT=3000
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1234567890
PUBLIC_URL=https://your-ngrok-url.ngrok-free.app
```

## Usage

### Local Development

1.  **Start the server**:
    ```bash
    npm run dev
    ```
2.  **Expose local server** (using ngrok):
    ```bash
    ngrok http 3000
    ```
3.  Update `PUBLIC_URL` in `.env` and Twilio Webhook configuration with the ngrok URL.

### Production

1.  **Start the server**:
    ```bash
    npm start
    ```
    Or use PM2:
    ```bash
    pm2 start src/server.js --name "voice-bot"
    ```

## Deployment

### Ubuntu Server

1.  Install Node.js and PM2.
2.  Clone the repo and install dependencies.
3.  Set up `.env`.
4.  Start with PM2.
5.  (Optional) Set up Nginx as a reverse proxy with SSL (Let's Encrypt).

## Structure

- `src/config`: Configuration and prompts.
- `src/controllers`: Request handlers.
- `src/services`: Business logic (OpenAI, appointments, etc.).
- `src/utils`: Helpers (logger, validator).
