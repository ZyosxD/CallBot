# 🤖 1WIRE AI COLD CALLER (SARAH) 📞

¡Bienvenido a Sarah, el **1Wire Assistant** de última generación! 🚀
Este proyecto es un asistente de voz inteligente, agresivo en ventas y enfocado en agendar **Evaluaciones Técnicas** (Technical Assessments) para Internet, VoIP e IT.

¡Con una arquitectura Node.js + Fastify súper optimizada para entornos de baja RAM! 🗣️✨

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

*   **Real-time Audio**: Conversaciones fluidas usando la API Realtime de OpenAI.
*   **Voz OpenAI "Coral"**: Tono casual e imperfecto (usa "um", "uh", "you know").
*   **Goteo Inteligente (Smart Drip)**: Estrategia de llamadas salientes (Outbound) respetando horarios de operación y gestionando la cola inteligentemente.
*   **Gestión de Logs y Reportes**: Sistema de notificaciones por correo (Nodemailer) cuando se agenda una cita (🟢 SUCCESS) o se requiere atención (🟠 REPORT).
*   **Arquitectura Robusta**: Construido en Node.js, Fastify y WebSockets para menor latencia y mayor rendimiento.

---

## 🛠️ Requisitos Previos

Antes de empezar, asegúrate de tener:

*   **Node.js** (v18 o superior) instalado. [Descargar aquí](https://nodejs.org/)
*   Una cuenta en **Twilio** con un número de teléfono. [Registrarse](https://www.twilio.com/)
*   Una cuenta en **OpenAI** con acceso a la API (Key). [Obtener API Key](https://platform.openai.com/)
*   Credenciales SMTP para el envío de correos.
*   **Ngrok** (para pruebas locales). [Descargar](https://ngrok.com/)

---

## 🚀 Instalación Paso a Paso

### 1. Clonar o Descargar el Proyecto
Abre tu terminal y ve a la carpeta del proyecto:

\`\`\`bash
cd voice-bot
\`\`\`

### 2. Instalar Dependencias
Instala todas las librerías necesarias ejecutando:

\`\`\`bash
npm install
\`\`\`

---

## ⚙️ Configuración de Twilio

Para que Twilio sepa dónde enviar las llamadas Inbound y Outbound, necesitamos configurar un Webhook.

1.  Ve a tu **Consola de Twilio** > **Phone Numbers** > **Manage** > **Active numbers**.
2.  Haz clic en tu número de teléfono.
3.  Baja hasta la sección **Voice & Fax**.
4.  En **A CALL COMES IN**, selecciona **Webhook**.
5.  Aquí pondrás tu URL pública:
    *   La URL se verá algo así: \`https://tu-url-ngrok.app/voice/inbound\`
    *   **IMPORTANTE**: Asegúrate de que sea \`HTTP POST\`.
6.  ¡Guarda los cambios! 💾

---

## 🔑 Variables de Entorno (.env)

Crea un archivo llamado \`.env\` en la carpeta superior a \`src/\` y rellena tus datos:

\`\`\`ini
# 🤖 Tu clave de OpenAI
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx

# 🚪 Puerto del servidor (por defecto 3000)
PORT=3000

# 📞 Credenciales de Twilio (Búscalas en tu consola de Twilio)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1234567890

# 🌐 Tu URL pública (Ngrok o Dominio real)
# No olvides incluir 'https://' y sin barra al final
PUBLIC_URL=https://tu-url-ngrok.ngrok-free.app

# 📧 Configuración de Correo (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=tu-correo@gmail.com
SMTP_PASS=tu-contraseña-de-aplicación
EMAIL_FROM="Sarah Assistant" <tu-correo@gmail.com>
EMAIL_TO=admin@tu-empresa.com
\`\`\`

---

## 💻 Ejecutar en Local

¡Hora de probarlo! Sigue estos pasos para ver la magia en tu computadora.

### 1. Levantar el Túnel (Ngrok)
En una terminal nueva, ejecuta:

\`\`\`bash
ngrok http 3000
\`\`\`
Copia la URL que dice \`Forwarding\`.

### 2. Iniciar el Servidor
En la terminal de tu proyecto, ejecuta:

\`\`\`bash
npm run dev
\`\`\`

### 3. ¡Llama a tu Bot o Deja que llame! 📱
Puedes marcar al número para probar Inbound, o añadir clientes a \`src/data/clients.json\` con \`status: "PENDING"\` para probar el Drip Service.

---

## 🌐 Despliegue en Servidor (Ubuntu/VPS)

¿Listo para ir a producción? 🌍

1.  **Prepara el servidor**: Instala Node.js, PM2 y habilita el 1GB de Swap.
2.  **Sube el código**: Clona tu repo o sube los archivos.
3.  **Instala dependencias**: \`npm install\`
4.  **Configura el .env**: Crea el archivo \`.env\` con los datos reales.
5.  **Usa PM2** (Gestor de procesos) para que no se apague nunca:
    \`\`\`bash
    sudo npm install -g pm2
    pm2 start src/server.js --name "voice-bot"
    pm2 save
    pm2 startup
    \`\`\`

---

Hecho con ❤️ para generar ventas. ¡Disfruta tu nuevo asistente! 🎉
