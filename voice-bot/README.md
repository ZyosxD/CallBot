# 🤖 1WIRE AI COLD CALLER (SARAH)

¡Bienvenido al repositorio del Asistente de IA "Sarah"! Este proyecto implementa un bot de voz inteligente diseñado para realizar llamadas en frío y agendar evaluaciones técnicas.

## 🌟 Características Principales

*   **Identidad:** Sarah, Asistente de 1Wire (Utah, USA).
*   **Voz:** OpenAI "Coral" (Natural, imperfecta).
*   **Motor:** Node.js + Fastify + WebSocket (OpenAI Realtime API).
*   **Telefonía:** Twilio (Inbound/Outbound).
*   **Smart Drip:** Sistema de llamadas inteligente que respeta horarios y evita duplicados.
*   **Reportes:** Emails automáticos con resumen de interacción (Verde/Naranja).

## 🚀 Instalación y Configuración

Sigue estos pasos para poner en marcha a Sarah.

### 1. Requisitos Previos

*   Node.js (v18+)
*   Cuenta de Twilio (Account SID, Auth Token, Número de teléfono)
*   Cuenta de OpenAI (API Key con acceso a Realtime API)
*   Cuenta de Gmail (para envío de correos vía SMTP)

### 2. Clonar y Preparar

```bash
git clone <repo-url>
cd voice-bot
npm install
```

### 3. Configuración de Entorno (.env)

Crea un archivo `.env` en la raíz (`voice-bot/.env`) con las siguientes variables:

```env
OPENAI_API_KEY=sk-...
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...
PUBLIC_URL=https://tu-dominio.ngrok-free.app
NOTIFICATION_EMAIL=tu-email@dominio.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-app-password
```

### 4. Datos Iniciales

Edita `src/data/clients.json` para agregar los contactos a llamar:

```json
[
  {
    "id": "1",
    "name": "Empresa A",
    "phone": "+18015550100",
    "status": "PENDING"
  }
]
```

### 5. Ejecución

Para desarrollo (con recarga automática):

```bash
npm run dev
```

Para producción:

```bash
npm start
```

## 🧠 Arquitectura "Smart Drip"

El sistema opera automáticamente en los siguientes horarios (Mountain Time):
*   🌞 **Mañana:** 09:30 AM - 11:30 AM
*   🌤️ **Tarde:** 02:30 PM - 03:30 PM

El bot tomará un cliente "PENDING", lo marcará como "CALLED" y realizará la llamada. Esperará a que termine antes de iniciar la siguiente.

## 🛠️ Herramientas (Tools)

Sarah tiene acceso a:
*   `schedule_appointment`: Agenda cita y envía email 🟢.
*   `report_interaction`: Reporta resultado (no interesado/buzón) y envía email 🟠.
*   `end_call`: Cierra la llamada educadamente.

## 📂 Estructura del Proyecto

*   `src/server.js`: Punto de entrada (Fastify).
*   `src/controllers/`: Manejadores de rutas y WebSocket.
*   `src/services/`: Lógica de negocio (OpenAI, Drip, Email, Lead).
*   `src/data/`: Archivos JSON de persistencia.
*   `src/config/`: Configuración y Prompts.

---
Hecho con ❤️ por el equipo de ingeniería.
