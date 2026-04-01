# 🤖 1WIRE AI COLD CALLER (SARAH) 📞

¡Bienvenido a **Sarah (1Wire Assistant)**! 🚀
Este proyecto es un agente de IA impulsado por OpenAI Realtime API y Twilio, diseñado específicamente para ventas agresivas y telemarketing. Su objetivo principal es agendar "Evaluaciones Técnicas" para servicios de Internet, VoIP e IT.

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

*   **Identidad y Personalidad**: Voz "Coral" (OpenAI), con tono casual e imperfecto. Actúa como vendedora agresiva 10000% enfocada en agendar citas.
*   **Modos (Inbound/Outbound)**: Funciona como recepcionista inteligente (Inbound) y como motor de llamadas en frío (Outbound).
*   **Motor "Smart Drip"**: Llama automáticamente a los prospectos en ventanas de tiempo específicas de Mountain Time (9:30 AM - 11:30 AM y 2:30 PM - 3:30 PM).
*   **Recolección "La Trifecta"**: Captura Nombre, Empresa, Teléfono Confirmado y Hora Exacta antes de cerrar.
*   **Reportes por Email**: Envío automático de resúmenes codificados por color (🟢 Éxito, 🟠 Interacción) vía Nodemailer.

---

## 🛠️ Requisitos Previos

*   **Node.js** (v18 o superior).
*   Cuenta de **Twilio** y número de teléfono.
*   API Key de **OpenAI** con acceso a la API Realtime.
*   Servidor SMTP (Ej: Gmail) para notificaciones.

---

## 🚀 Instalación Paso a Paso

### 1. Clonar el Proyecto y entrar a la carpeta

```bash
cd voice-bot
```

### 2. Instalar Dependencias

```bash
npm install
```

---

## ⚙️ Configuración de Twilio

Para que Twilio sepa dónde enviar las llamadas entrantes, necesitamos configurar un Webhook.

1.  Ve a tu **Consola de Twilio** > **Active numbers**.
2.  Haz clic en tu número de teléfono y ve a **Voice & Fax**.
3.  En **A CALL COMES IN**, selecciona **Webhook**.
4.  Pega tu URL pública (ej: `https://tu-url.com/voice/inbound`) usando `HTTP POST`.
5.  ¡Guarda los cambios!

---

## 🔑 Variables de Entorno (.env)

Crea el archivo `.env` en `voice-bot/`:

```ini
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx
PORT=3000

TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1234567890

PUBLIC_URL=https://tu-url.com

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-app-password
NOTIFICATION_EMAIL=notificaciones@tuempresa.com
```

---

## 💻 Ejecutar en Local

Para pruebas locales, usa Ngrok:

```bash
ngrok http 3000
```
Pega la URL de Ngrok en `PUBLIC_URL` del `.env`.

Para iniciar:

```bash
kill $(lsof -t -i :3000) 2>/dev/null || true && cd voice-bot && PORT=3000 npm run start
```

---

## 🌐 Despliegue en Servidor (Ubuntu/VPS)

Optimizado para Low RAM envs de AWS con 1GB Swap activa.

```bash
sudo npm install -g pm2
pm2 start src/server.js --name "voice-bot"
pm2 save
pm2 startup
```

---

## 📂 Estructura del Proyecto

```
/voice-bot/
├── src/
│   ├── config/          # ⚙️ Prompts y variables globales
│   ├── controllers/     # 🎮 Controladores Fastify (Call Controller)
│   ├── services/        # 🧠 OpenAI Realtime, Drip Campaign, Emailing
│   ├── data/            # 📁 Base de datos local (clients.json, leads.json, interactions.json)
│   ├── utils/           # 🛠️ Logger y validadores
│   └── server.js        # 🏁 Punto de entrada del servidor
├── package.json         # 📦 Dependencias (Fastify)
└── README.md            # 📖 Documentación
```

