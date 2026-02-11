# 🤖 Voice Bot - Sarah (1Wire Assistant) 📞

¡Bienvenido al Voice Bot **Sarah** de 1Wire! 🚀
Este asistente de voz inteligente está diseñado para realizar llamadas en frío (Cold Calling) utilizando la API Realtime de OpenAI y Twilio. Su objetivo es agendar "Evaluaciones Técnicas" siguiendo una estrategia de "Goteo Inteligente" (Smart Drip).

---

## 📋 Tabla de Contenidos

1.  [🌟 Identidad y Objetivo](#-identidad-y-objetivo)
2.  [🛠️ Arquitectura Técnica](#-arquitectura-técnica)
3.  [⚙️ Configuración y Requisitos](#-configuración-y-requisitos)
4.  [🚀 Instalación y Ejecución](#-instalación-y-ejecución)
5.  [🧠 Motor de Llamadas (Smart Drip)](#-motor-de-llamadas-smart-drip)
6.  [📧 Reportes y Email](#-reportes-y-email)
7.  [📂 Estructura del Proyecto](#-estructura-del-proyecto)

---

## 🌟 Identidad y Objetivo

*   **Nombre:** Sarah (1Wire Assistant).
*   **Voz:** OpenAI "Coral" (Tono casual, imperfecto).
*   **Misión:** Agendar citas para servicios de Internet, VoIP e IT.
*   **Regla de Oro:** 🚫 Nunca decir "Chat" o "AI". Siempre hablar como un humano del equipo local.

---

## 🛠️ Arquitectura Técnica

*   **Motor:** Node.js + Fastify ⚡
*   **IA:** OpenAI Realtime API (WebSocket).
*   **Telefonía:** Twilio (Inbound/Outbound).
*   **Scheduler:** `node-cron` para horarios de operación (Mountain Time).
*   **Email:** Nodemailer (SMTP).
*   **Datos:** Gestión local con archivos JSON (`src/data/`).

---

## ⚙️ Configuración y Requisitos

Crea un archivo `.env` en la raíz `voice-bot/` con las siguientes variables:

```ini
# 🤖 OpenAI
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx

# 🚪 Servidor
PORT=3000
PUBLIC_URL=https://tu-url-publica.ngrok-free.app

# 📞 Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1234567890

# 📧 Email (SMTP - Gmail u otro)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-password-app
NOTIFICATION_EMAIL=destinatario@empresa.com
```

---

## 🚀 Instalación y Ejecución

### 1. Instalar Dependencias
```bash
cd voice-bot
npm install
```

### 2. Ejecutar el Servidor
```bash
npm start
# O para desarrollo:
npm run dev
```

### 3. Verificar Operación
El servidor iniciará en el puerto 3000.
El sistema "Smart Drip" verificará automáticamente si está dentro del horario operativo para comenzar a llamar.

---

## 🧠 Motor de Llamadas (Smart Drip)

El bot lee los contactos desde `src/data/clients.json`.

*   **Lógica:** Busca clientes con status `PENDING`, los marca como `CALLED` y realiza la llamada. Al terminar, espera unos segundos y sigue con el siguiente.
*   **Horarios (Mountain Time):**
    *   🌞 Mañana: 9:30 AM - 11:30 AM
    *   🌤️ Tarde: 2:30 PM - 3:30 PM

**Formato de `clients.json`:**
```json
[
  {
    "id": 1,
    "name": "Juan Perez",
    "company": "Empresa X",
    "phone": "+1234567890",
    "status": "PENDING"
  }
]
```

---

## 📧 Reportes y Email

El bot envía correos automáticos mediante Nodemailer:

*   🟢 **Éxito (Verde):** Cuando se agenda una cita (`schedule_appointment`). Incluye detalles de la empresa, contacto y hora.
*   🔸 **Reporte (Naranja):** Interacciones sin cita (`report_interaction`). Incluye resultado (no interesado, buzón) y notas.

---

## 📂 Estructura del Proyecto

```
/voice-bot/
├── src/
│   ├── config/          # ⚙️ Configuración y Prompts de Sarah
│   ├── controllers/     # 🎮 Controladores (Fastify)
│   ├── data/            # 💾 Base de datos JSON (clients, leads, interactions)
│   ├── services/        # 🧠 Lógica (OpenAI, Drip, Email, Scheduler)
│   ├── utils/           # 🛠️ Loggers y utilidades
│   └── server.js        # 🏁 Servidor Fastify
├── .env                 # 🔐 Variables de entorno
├── package.json         # 📦 Dependencias
└── README.md            # 📖 Documentación
```

---

Hecho con ❤️ por **Jules**.
