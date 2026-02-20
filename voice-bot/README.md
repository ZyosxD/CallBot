# 🤖 SARAH - 1Wire AI Cold Caller 📞

¡Hola! Soy Sarah, tu asistente de Inteligencia Artificial para **1Wire**. Mi misión es agendar "Evaluaciones Técnicas" para servicios de Internet, VoIP e IT en Utah. 🏔️

---

## 📋 Identidad y Objetivo

*   **Nombre:** Sarah (1Wire Assistant).
*   **Voz:** OpenAI "Coral" (Casual, imperfecta).
*   **Ubicación:** Utah, USA.
*   **Misión:** Conseguir la "Trifecta" (Nombre, Empresa, Teléfono) + Hora de Cita.
*   **Regla de Oro:** 🚫 NUNCA decir la palabra "Chat".

---

## 🛠️ Arquitectura (Core V8)

*   **Motor:** Node.js + Fastify + WebSocket.
*   **Inteligencia:** OpenAI Realtime API (GPT-4o).
*   **Telefonía:** Twilio (Outbound/Inbound).
*   **Modo:** "Smart Drip" (Goteo Inteligente).
*   **Infraestructura:** Optimizado para servidores con 1GB Swap.

---

## 🚀 Instalación y Despliegue

### 1. Requisitos Previos
*   Node.js v18+.
*   Cuenta de Twilio (SID, Token, Número).
*   Cuenta de OpenAI (API Key).
*   Servidor SMTP (Gmail, etc.) para reportes.

### 2. Instalación

```bash
cd voice-bot
npm install
```

### 3. Configuración (.env)
Crea un archivo `.env` en la raíz con tus secretos:

```ini
# OpenAI
OPENAI_API_KEY=sk-proj-...

# Twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1801...

# Server
PORT=3000
PUBLIC_URL=https://tu-dominio.com

# SMTP (Reportes por Email)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-password-app
```

### 4. Carga de Clientes
Edita `clients.json` para agregar a tus prospectos:

```json
[
  {
    "id": 1,
    "company": "Empresa X",
    "contact": "John Doe",
    "phone": "+18015550100",
    "status": "PENDING"
  }
]
```

### 5. Iniciar el Motor
El bot iniciará el servidor y el cron job de llamadas automáticas (Smart Drip).

```bash
npm start
```

⚠️ **Horario de Operación:**
*   Mañana: 9:30 AM - 11:30 AM (Mountain Time)
*   Tarde: 2:30 PM - 3:30 PM (Mountain Time)

---

## 🧠 Flujo de Conversación

1.  **Gatekeeper:** "¿Manejas tú la tecnología o pregunto por un Office Manager?"
2.  **Internet Hook:** "¿Han notado lentitud o cortes con Comcast/CenturyLink?"
3.  **VoIP Pitch:** "Comparativa Teléfonos Viejos vs Nube."
4.  **IT/MSP Pitch:** "Ahorro de costos ($59 vs $100)."
5.  **Cierre:** Agendar llamada de 5 minutos con especialista.

---

## 📊 Reportes y Logs

*   **✅ Éxito (Verde):** Se envía email cuando se agenda una cita. Se guarda en `leads.json`.
*   **⚠️ Interacción (Naranja):** Se envía email con reporte (No interesado, Buzón, etc). Se guarda en `clients_log.json`.

---

Hecho con ❤️ para 1Wire.
