# 🤖 Sarah (1Wire Assistant) - Voice AI Bot 📞

¡Bienvenido al repositorio de **Sarah**, tu asistente de ventas y recepción de **1Wire**! 🚀
Sarah es una inteligencia artificial de voz ultra-realista diseñada para:
1.  **Cold Calling (Smart Drip):** Generar ventas salientes de manera estratégica.
2.  **Recepción Inbound:** Atender llamadas entrantes con un enfoque 100% comercial.

---

## 📋 Tabla de Contenidos

1.  [🌟 Identidad y Capacidades](#-identidad-y-capacidades)
2.  [🏗️ Arquitectura Técnica](#-arquitectura-técnica)
3.  [⚙️ Configuración (.env)](#-configuración-env)
4.  [🚀 Instalación y Ejecución](#-instalación-y-ejecución)
5.  [💧 Motor de Llamadas (Smart Drip)](#-motor-de-llamadas-smart-drip)
6.  [📥 Modo Recepción (Inbound)](#-modo-recepción-inbound)
7.  [📊 Datos y Reportes](#-datos-y-reportes)
8.  [📂 Estructura del Proyecto](#-estructura-del-proyecto)

---

## 🌟 Identidad y Capacidades

*   **Nombre:** Sarah (1Wire Assistant).
*   **Ubicación:** Utah, USA (Equipo Local).
*   **Voz:** OpenAI "Coral" (Tono casual, imperfecto).
*   **Objetivo:** Agendar "Evaluaciones Técnicas" (Technical Assessments).
*   **Regla de Oro:** 🚫 Nunca decir la palabra "Chat". Siempre hablar de llamadas.

---

## 🏗️ Arquitectura Técnica

Este proyecto está construido sobre el **Core V8**:

*   **Motor:** Node.js + Fastify + WebSocket (OpenAI Realtime API).
*   **Telefonía:** Twilio (Inbound/Outbound).
*   **Estabilidad:** PM2 Ready.
*   **Latencia:** VAD ajustado a 1500ms para evitar interrupciones.

---

## ⚙️ Configuración (.env)

Crea un archivo `.env` en la raíz `voice-bot/` con las siguientes variables:

```ini
# 🤖 OpenAI
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx

# 📞 Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1234567890

# 🌐 Servidor
PORT=3000
PUBLIC_URL=https://tu-url-publica.com # ⚠️ CRUCIAL: Sin barra al final

# 📧 Notificaciones (SMTP)
NOTIFICATION_EMAIL=tu@email.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu@gmail.com
SMTP_PASS=tu-password-de-aplicacion
```

---

## 🚀 Instalación y Ejecución

### 1. Instalar Dependencias
```bash
cd voice-bot
npm install
```

### 2. Iniciar el Servidor
```bash
npm start
```
Verás: `Server is running on port 3000` ✅

### 3. Verificar Horarios
El sistema comprobará automáticamente si está dentro del horario operativo de Mountain Time (Utah) para iniciar el goteo de llamadas.

---

## 💧 Motor de Llamadas (Smart Drip)

El bot no llama a lo loco. Usa una estrategia inteligente:

*   **Horario (Mountain Time):**
    *   ☀️ Mañana: 9:30 AM - 11:30 AM
    *   🌤️ Tarde: 2:30 PM - 3:30 PM
*   **Lógica:**
    1.  Lee `src/data/clients.json`.
    2.  Busca el primer `PENDING`.
    3.  Marca como `CALLED`.
    4.  Llama y espera a que termine **por completo** antes de seguir.

---

## 📥 Modo Recepción (Inbound)

Si alguien llama a tu número de Twilio:

1.  Sarah contesta como **Recepcionista**.
2.  Su objetivo es **VENDER** productos y servicios de 1Wire.
3.  Intentará agendar una "Evaluación Técnica" a toda costa (amablemente).

---

## 📊 Datos y Reportes

El sistema gestiona datos en archivos JSON locales (`src/data/`):

*   `clients.json`: Base de datos de clientes a llamar.
*   `leads.json`: Citas exitosas agendadas 🟢.
*   `interactions.json`: Reportes de llamadas no exitosas 🟠.

Además, envía correos electrónicos automáticos con colores en el asunto:
*   🟢 **NEW LEAD:** Éxito total.
*   🟠 **INTERACTION REPORT:** Cliente no interesado o buzón.

---

## 📂 Estructura del Proyecto

```
/voice-bot/
├── src/
│   ├── config/          # ⚙️ Configuración y Prompts (Sarah)
│   ├── controllers/     # 🎮 Call Controller (Fastify)
│   ├── services/        # 🧠 Lógica (OpenAI, Drip, Scheduler, Email)
│   ├── utils/           # 🛠️ Logger
│   ├── data/            # 🗄️ JSON Files (Clients, Leads)
│   └── server.js        # 🏁 Servidor Fastify
├── .env                 # 🔐 Secretos
└── README.md            # 📖 Este manual
```

---

Hecho con ❤️ para **1Wire**. ¡A vender! 💸
