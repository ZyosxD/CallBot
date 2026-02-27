# 🤖 1WIRE AI COLD CALLER & RECEPTIONIST (SARAH)

## Identidad
* **Nombre:** Sarah (1Wire Assistant)
* **Ubicación:** Utah, USA
* **Voz:** OpenAI "Coral"
* **Objetivo:** Agendar "Evaluaciones Técnicas" (Technical Assessments) para Internet, VoIP e IT.

## Arquitectura
* **Backend:** Node.js + Express + WebSocket
* **IA:** OpenAI Realtime API (GPT-4o)
* **Telefonía:** Twilio (Inbound/Outbound)
* **Infraestructura:** AWS / PM2

## Características
* **Smart Drip:** Realiza llamadas salientes automáticas respetando horarios (Mountain Time) y concurrencia.
* **Recepción Inteligente:** Atiende llamadas entrantes, filtra gatekeepers y agenda citas.
* **Email Reporting:** Envía reportes de éxito (Verde) y logs de interacción (Naranja) via SMTP.
* **Tools:**
  - `schedule_appointment`: Agenda cita tras recolectar datos (Trifecta).
  - `report_interaction`: Reporta resultados de llamadas no exitosas.
  - `end_call`: Finaliza la llamada educadamente.

## Configuración (.env)
Asegúrate de configurar las siguientes variables:
```env
PORT=3000
PUBLIC_URL=https://tu-url-publica.com
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...
OPENAI_API_KEY=...
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-password-app
NOTIFICATION_EMAIL=email-destino@empresa.com
```

## Ejecución
```bash
npm install
npm start
```
