# 🤖 1WIRE AI COLD CALLER (SARAH) 📞

¡Bienvenido a tu **Voice Bot** de última generación! 🚀
Este proyecto es un asistente de voz inteligente capaz de atender llamadas telefónicas (Inbound) y realizar llamadas en frío (Outbound) en tiempo real para agendar Evaluaciones Técnicas de Internet, VoIP e IT. ¡Todo con una latencia mínima y la voz natural "Coral" de OpenAI! 🗣️✨

---

## 📋 Tabla de Contenidos

1. [🌟 Características](#-características)
2. [🛠️ Requisitos Previos](#-requisitos-previos)
3. [🚀 Instalación Paso a Paso](#-instalación-paso-a-paso)
4. [⚙️ Configuración de Twilio](#-configuración-de-twilio)
5. [🔑 Variables de Entorno (.env)](#-variables-de-entorno-env)
6. [💻 Ejecutar en Local](#-ejecutar-en-local)
7. [🌐 Despliegue en Servidor (AWS/Ubuntu)](#-despliegue-en-servidor-awsubuntu)
8. [📂 Estructura del Proyecto](#-estructura-del-proyecto)

---

## 🌟 Características

*   **Real-time Audio**: Conversaciones fluidas usando la API Realtime de OpenAI y Fastify con WebSockets.
*   **Bilingüe**: Detecta y habla Español 🇪🇸 e Inglés 🇺🇸 automáticamente con acento perfecto.
*   **Goteo Inteligente (Smart Drip)**: Motor de llamadas salientes automatizado (9:30-11:30 AM y 2:30-3:30 PM Mountain Time).
*   **Agendamiento Seguro (La Trifecta)**: Agenda citas solo si recolecta Nombre, Empresa, Teléfono y Hora de cita.
*   **Reportes Email**: Alertas de interacción y éxito codificadas por color usando Nodemailer.
*   **Baja Latencia**: Optimizado con VAD a 1500ms para pausas naturales.

---

## 🛠️ Requisitos Previos

Antes de empezar, asegúrate de tener:

*   **Node.js** (v18 o superior) instalado. [Descargar aquí](https://nodejs.org/)
*   Una cuenta en **Twilio** con un número de teléfono. [Registrarse](https://www.twilio.com/)
*   Una cuenta en **OpenAI** con acceso a la API (Key). [Obtener API Key](https://platform.openai.com/)
*   **Ngrok** (para pruebas locales). [Descargar](https://ngrok.com/)

---

## 🚀 Instalación Paso a Paso

### 1. Clonar o Descargar el Proyecto
Abre tu terminal y ve a la carpeta del proyecto:

```bash
cd voice-bot
```

### 2. Instalar Dependencias
Instala todas las librerías necesarias ejecutando:

```bash
npm install
```

¡Verás como se instalan `fastify`, `@fastify/websocket`, `twilio`, `openai` y otras herramientas de alto rendimiento! ⚡

---

## ⚙️ Configuración de Twilio

Para que Twilio sepa dónde enviar las llamadas entrantes, necesitamos configurar un Webhook.

1.  Ve a tu **Consola de Twilio** > **Phone Numbers** > **Manage** > **Active numbers**.
2.  Haz clic en tu número de teléfono.
3.  Baja hasta la sección **Voice & Fax**.
4.  En **A CALL COMES IN**, selecciona **Webhook**.
5.  Aquí pondrás tu URL pública (veremos como obtenerla con Ngrok en la sección "Ejecutar en Local").
    *   La URL se verá algo así: `https://tu-url-ngrok.app/voice/inbound`
    *   **IMPORTANTE**: Asegúrate de que sea `HTTP POST`.
6.  ¡Guarda los cambios! 💾

---

## 🔑 Variables de Entorno (.env)

Crea un archivo llamado `.env` en la raíz del proyecto (`voice-bot/`). Rellena tus datos:

```ini
# 🤖 Tu clave de OpenAI
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx

# 🚪 Puerto del servidor (por defecto 3000)
PORT=3000

# 📞 Credenciales de Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1234567890

# 🌐 Tu URL pública (Ngrok o Dominio real) - Necesaria para Webhooks y Drip Engine
PUBLIC_URL=https://tu-url-ngrok.ngrok-free.app

# 📧 Configuración de Email (SMTP y Alertas)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-contraseña-de-aplicación
NOTIFICATION_EMAIL=equipo-ventas@tuempresa.com
```

---

## 💻 Ejecutar en Local

¡Hora de probarlo! Sigue estos pasos para ver la magia en tu computadora.

### 1. Levantar el Túnel (Ngrok)
En una terminal nueva, ejecuta:

```bash
ngrok http 3000
```
Copiar la URL que dice `Forwarding` (ej: `https://a1b2-c3d4.ngrok-free.app`).

👉 **Pega esta URL en tu archivo `.env` en `PUBLIC_URL`.**
👉 **Pega esta URL + `/voice/inbound` en tu configuración de Twilio.**

### 2. Iniciar el Servidor
En la terminal de tu proyecto, ejecuta:

```bash
npm run dev
```
Verás: `Server is running on port 3000` ✅

### 3. ¡Prueba el Bot! 📱
*   **Inbound**: Llama a tu número de Twilio. "Sarah" actuará como recepcionista.
*   **Outbound (Drip)**: Añade un contacto a `src/data/clients.json` con `"status": "PENDING"`. El bot lo llamará automáticamente dentro del horario operativo (Mountain Time).

---

## 🌐 Despliegue en Servidor (AWS/Ubuntu)

¿Listo para producción en AWS con poca RAM? 🌍

1.  **Activar Swap Memory (1GB)**: Crucial para evitar cuelgues del servidor.
2.  **Prepara el servidor**: Instala Node.js y Git en tu servidor Ubuntu.
3.  **Sube el código**: Clona tu repo o sube los archivos.
4.  **Instala dependencias**: `npm install`
5.  **Configura el .env**: Crea el archivo `.env` con los datos reales.
6.  **Usa PM2** (Gestor de procesos) para resiliencia:
    ```bash
    sudo npm install -g pm2
    pm2 start src/server.js --name "sarah-bot" --time
    pm2 save
    pm2 startup
    ```

---

## 📂 Estructura del Proyecto

Para que no te pierdas, aquí está organizado todo:

```
/voice-bot/
├── src/
│   ├── config/          # ⚙️ Configuración y Prompts de Sarah (Inbound/Outbound)
│   ├── controllers/     # 🎮 Controladores Fastify de llamadas y rutas
│   ├── services/        # 🧠 OpenAI Realtime, Drip Engine, Nodemailer Mailer
│   ├── utils/           # 🛠️ Logger Winston, Validador de Firmas Twilio
│   └── data/            # 📁 JSON DB: clients.json, leads.json, interactions.json
│   └── server.js        # 🏁 Punto de entrada del servidor Fastify
├── .env                 # 🔐 Tus secretos (¡No compartir!)
├── package.json         # 📦 Lista de librerías
└── README.md            # 📖 Este manual
```

---

Hecho con ❤️ y código para maximizar ventas. ¡A agendar citas! 🎉
