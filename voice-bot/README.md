# 🤖 Voice Bot: Sarah (1Wire Assistant) 📞

¡Bienvenido a **Sarah**, tu asistente de voz de Inteligencia Artificial para 1Wire! 🚀
Este proyecto implementa un bot de llamadas dual: **Cold Caller** (Saliente) y **Recepcionista** (Entrante), con un enfoque agresivo en ventas y agendamiento de citas.

---

## 📋 Tabla de Contenidos

1. [🌟 Identidad y Características](#-identidad-y-características)
2. [🛠️ Requisitos Previos](#-requisitos-previos)
3. [🚀 Instalación](#-instalación)
4. [⚙️ Configuración (.env)](#-configuración-env)
5. [💧 Motor de Llamadas (Smart Drip)](#-motor-de-llamadas-smart-drip)
6. [💻 Ejecutar en Local](#-ejecutar-en-local)
7. [📂 Estructura del Proyecto](#-estructura-del-proyecto)

---

## 🌟 Identidad y Características

*   **Nombre:** Sarah (1Wire Assistant).
*   **Voz:** OpenAI "Coral" (Tono casual, imperfecto).
*   **Latencia:** VAD de 1500ms para no interrumpir.
*   **Modo Outbound (Cold Caller):** Llama a prospectos para agendar "Evaluaciones Técnicas" de Internet, VoIP e IT. Usa estrategias de ingeniería social.
*   **Modo Inbound (Recepcionista):** Atiende llamadas con enfoque 10000% en VENTAS. Convierte dudas en citas.
*   **Herramientas:** Agenda citas (`schedule_appointment`), reporta interacciones (`report_interaction`), y finaliza llamadas (`end_call`).
*   **Reportes:** Envía emails automáticos con detalles de la llamada (Verde = Éxito, Naranja = Reporte).

---

## 🛠️ Requisitos Previos

*   **Node.js** (v18+)
*   Cuenta de **Twilio** (SID, Token, Número).
*   Cuenta de **OpenAI** (API Key).
*   Servidor SMTP (Gmail, etc.) para enviar reportes.

---

## 🚀 Instalación

1.  Clona el repositorio y entra a la carpeta:
    ```bash
    cd voice-bot
    ```
2.  Instala las dependencias:
    ```bash
    npm install
    ```

---

## ⚙️ Configuración (.env)

Crea un archivo `.env` en la raíz (`voice-bot/`) con tus credenciales:

```ini
# 🤖 OpenAI
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx

# 📞 Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+18015550100

# 🌐 Servidor
PORT=3000
PUBLIC_URL=https://tu-url-ngrok.ngrok-free.app

# 📧 Email (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-contraseña-de-aplicación
NOTIFICATION_EMAIL=admin@1wire.com
```

---

## 💧 Motor de Llamadas (Smart Drip)

El bot incluye un sistema automático de llamadas salientes:

1.  Lee clientes desde `src/data/clients.json` con estado `PENDING`.
2.  Llama uno a uno (concurrencia = 1) respetando horarios de montaña (MDT):
    *   Mañana: 9:30 AM - 11:30 AM
    *   Tarde: 2:30 PM - 3:30 PM
3.  Marca los clientes como `CALLED` para evitar duplicados.

**Para cargar clientes:** Edita `src/data/clients.json`.

---

## 💻 Ejecutar en Local

1.  Inicia Ngrok (o tu túnel favorito):
    ```bash
    ngrok http 3000
    ```
    Copia la URL pública en `PUBLIC_URL` dentro de `.env`.

2.  Configura el Webhook de Twilio (Voice) a:
    `TU_URL_PUBLICA/voice/inbound`

3.  Inicia el bot:
    ```bash
    npm start
    ```

¡Sarah empezará a trabajar inmediatamente si está dentro del horario operativo!

---

## 📂 Estructura del Proyecto

*   `src/config/prompts.js`: Los guiones y personalidad de Sarah.
*   `src/services/dripService.js`: Lógica del marcador automático.
*   `src/services/openaiRealtime.js`: Conexión con la IA.
*   `src/data/`: Almacenamiento local de clientes y leads (JSON).

---
Hecho con ❤️ para 1Wire.
