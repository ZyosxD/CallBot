# 🤖 1WIRE AI COLD CALLER (SARAH)

## 1. IDENTIDAD Y PERSONALIDAD
* **Nombre:** Sarah (1Wire Assistant).
* **Ubicación:** Utah, USA (Equipo Local).
* **Voz:** OpenAI "Coral" (Tono casual, imperfecto, usa "um", "uh", "you know").
* **Objetivo:** Agendar "Evaluaciones Técnicas" (Technical Assessments) para Internet, VoIP e IT.
* **Regla de Oro:** Nunca decir la palabra "Chat". Siempre hablar de llamadas con especialistas humanos.

## 2. ARQUITECTURA TÉCNICA
* **Motor:** Node.js + Express + WebSocket (OpenAI Realtime API).
* **Telefonía:** Twilio (Inbound/Outbound).
* **Estrategia:** "Smart Drip" (Llamadas inteligentes en horario laboral).
* **Base de Datos:** Archivos JSON locales (`clients.json`, `leads.json`, `interactions.json`).

## 3. MOTOR DE LLAMADAS (Goteo Inteligente)
El bot usa una estrategia de "Smart Drip":
* Lee `src/data/clients.json`.
* Busca contactos con `status: "PENDING"`.
* Marca como `status: "CALLED"` y ejecuta la llamada.
* Horario de Operación (Mountain Time): 9:30 AM - 11:30 AM y 2:30 PM - 3:30 PM.

## 4. INSTALACIÓN

1. **Instalar dependencias:**
   ```bash
   npm install
   ```

2. **Configurar Variables de Entorno (`.env`):**
   Crea un archivo `.env` en la raíz con lo siguiente:
   ```ini
   PORT=3000
   PUBLIC_URL=https://tu-url-ngrok.ngrok-free.app

   # OpenAI
   OPENAI_API_KEY=sk-...

   # Twilio
   TWILIO_ACCOUNT_SID=AC...
   TWILIO_AUTH_TOKEN=...
   TWILIO_PHONE_NUMBER=+1...

   # Email (SMTP)
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=tu-email@gmail.com
   SMTP_PASS=tu-password-app
   NOTIFICATION_EMAIL=reportes@1wire.com
   ```

3. **Cargar Clientes:**
   Edita `src/data/clients.json` con tus leads.

4. **Ejecutar:**
   ```bash
   npm start
   ```

## 5. HERRAMIENTAS
* `schedule_appointment`: Agenda cita y envía email VERDE.
* `report_interaction`: Reporta interés/buzón y envía email NARANJA.
* `end_call`: Termina la llamada respetuosamente.

---
Desarrollado para 1Wire.
