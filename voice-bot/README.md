# 🤖 Sarah (1Wire Assistant) - Voice Bot 📞

¡Bienvenido a tu **Voice Bot** de última generación! 🚀
Este proyecto implementa a **Sarah**, una asistente de voz inteligente diseñada para ventas outbound (Cold Calling) y recepción inbound (Ventas). Utiliza la API Realtime de OpenAI y Twilio.

---

## 📋 Tabla de Contenidos

1. [🌟 Características](#-características)
2. [🛠️ Requisitos Previos](#-requisitos-previos)
3. [🚀 Instalación Paso a Paso](#-instalación-paso-a-paso)
4. [⚙️ Configuración de Twilio](#-configuración-de-twilio)
5. [🔑 Variables de Entorno (.env)](#-variables-de-entorno-env)
6. [💻 Ejecutar en Local](#-ejecutar-en-local)
7. [🌐 Despliegue en Servidor (Ubuntu/VPS)](#-despliegue-en-servidor-ubuntuvps)
8. [📂 Estructura del Proyecto](#-estructura-del-proyecto)

---

## 🌟 Características

*   **Smart Drip (Outbound)**: Estrategia de llamadas automáticas inteligente.
    *   Lee de `src/data/clients.json`.
    *   Respeta horarios de operación: 9:30-11:30 y 14:30-15:30 (Mountain Time).
    *   Gestiona concurrencia (una llamada a la vez).
*   **Receptionist Mode (Inbound)**: Atiende llamadas entrantes con un enfoque agresivo en ventas (0 a 100).
*   **Real-time Audio**: Conversaciones fluidas con latencia mínima usando OpenAI Realtime API.
*   **Email Reports**: Notificaciones automáticas por correo electrónico.
    *   🟢 **Verde**: Nuevo Lead (Cita agendada).
    *   🟠 **Naranja**: Reporte de Interacción (No interesado, buzón, etc).
*   **Persistencia**: Gestiona clientes, leads e interacciones en archivos JSON locales (`src/data/`).

---

## 🛠️ Requisitos Previos

Antes de empezar, asegúrate de tener:

*   **Node.js** (v18 o superior).
*   Cuenta en **Twilio** (SID, Token y Número).
*   Cuenta en **OpenAI** (API Key).
*   Servidor SMTP (ej: Gmail App Password) para correos.
*   **Ngrok** (para pruebas locales).

---

## 🚀 Instalación Paso a Paso

### 1. Clonar o Descargar el Proyecto
Abre tu terminal y ve a la carpeta del proyecto:

```bash
cd voice-bot
```

### 2. Instalar Dependencias
Instala todas las librerías necesarias (Node.js + Express):

```bash
npm install
```

---

## ⚙️ Configuración de Twilio

Para las llamadas entrantes (Inbound):

1.  Ve a tu **Consola de Twilio** > **Phone Numbers**.
2.  En **A CALL COMES IN**, selecciona **Webhook**.
3.  URL: `https://tu-url-publica.com/voice/inbound` (POST).

Para las llamadas salientes (Outbound / Smart Drip):
*   El sistema usa automáticamente `PUBLIC_URL` definido en el `.env`. Asegúrate de que esta URL sea accesible desde internet.

---

## 🔑 Variables de Entorno (.env)

Crea un archivo `.env` en `voice-bot/` (ver `.env.example`).

```ini
# Core
OPENAI_API_KEY=sk-proj-...
PORT=3000
PUBLIC_URL=https://tu-url-ngrok.ngrok-free.app  <-- CRUCIAL para Outbound

# Twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1234567890

# Email (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-app-password
NOTIFICATION_EMAIL=destinatario@gmail.com
```

---

## 💻 Ejecutar en Local

### 1. Levantar Ngrok
```bash
ngrok http 3000
```
Copia la URL HTTPS y pégala en `PUBLIC_URL` dentro de `.env`.

### 2. Iniciar el Servidor
```bash
npm run dev
```
Verás: `Server is running on port 3000`.
El servicio "Smart Drip" iniciará automáticamente si `PUBLIC_URL` está configurado.

---

## 🌐 Despliegue en Servidor

1.  Configura el servidor (Ubuntu/VPS).
2.  Configura las variables de entorno.
3.  Usa PM2:
    ```bash
    pm2 start src/server.js --name "sarah-bot"
    ```

---

## 📂 Estructura del Proyecto

```
/voice-bot/
├── src/
│   ├── config/          # ⚙️ Prompts (Sarah) y Configuración
│   ├── controllers/     # 🎮 Inbound/Outbound Logic
│   ├── data/            # 🗄️ JSONs (clients, leads, interactions)
│   ├── services/        # 🧠 OpenAI, Drip, Email Service
│   ├── utils/           # 🛠️ Logger
│   └── server.js        # 🏁 Entry Point
├── .env                 # 🔐 Secretos
└── README.md            # 📖 Este manual
```

---

Hecho con ❤️ y código por **Jules**. ¡A vender! 🚀
