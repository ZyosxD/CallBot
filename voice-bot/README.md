# 🤖 1WIRE AI COLD CALLER (SARAH) 📞

¡Bienvenido a **Sarah**, tu Asistente de IA (1Wire Assistant) de última generación! 🚀
Este proyecto es un asistente de voz experto capaz de atender y realizar llamadas (Smart Drip) en tiempo real, agendando Evaluaciones Técnicas con una latencia mínima y la voz natural "Coral" de OpenAI. 🗣️✨

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
*   **Bilingüe**: Detecta y habla Español 🇪🇸 e Inglés 🇺🇸 automáticamente.
*   **Smart Drip**: Realiza llamadas automatizadas salientes dentro de horarios de oficina (Mountain Time) 📅.
*   **VAD Optimizado**: Voice Activity Detection de 1500ms para evitar interrupciones ⏱️.
*   **Reportes Color-coded**: Notificaciones de correo electrónico basadas en el resultado (Verde para Citas, Naranja para Reportes) 📧.
*   **Logs**: Guarda registro de todo lo que sucede 📝.

---

## 🛠️ Requisitos Previos

Antes de empezar, asegúrate de tener:

*   **Node.js** (v18 o superior) instalado. [Descargar aquí](https://nodejs.org/)
*   Una cuenta en **Twilio** con un número de teléfono. [Registrarse](https://www.twilio.com/)
*   Una cuenta en **OpenAI** con acceso a la API (Key). [Obtener API Key](https://platform.openai.com/)
*   **Ngrok** (para pruebas locales). [Descargar](https://ngrok.com/)
*   Cuenta de correo con SMTP habilitado.

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

¡Verás como se instalan `express`, `twilio`, `openai`, `ws` y otras herramientas mágicas! 🧙‍♂️

---

## ⚙️ Configuración de Twilio

Para que Twilio sepa dónde enviar las llamadas, necesitamos configurar un Webhook.

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

Crea un archivo llamado `.env` en la raíz del proyecto (`voice-bot/`). Puedes copiar este contenido y rellenar tus datos:

```ini
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

# 📧 SMTP y Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-password-app
NOTIFICATION_EMAIL=notificaciones@tuempresa.com
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

### 3. ¡Llama a tu Bot! 📱
Marca a tu número de Twilio. ¡Jules debería contestarte!

---

## 🌐 Despliegue en Servidor (Ubuntu/VPS)

¿Listo para ir a producción? 🌍

1.  **Prepara el servidor**: Instala Node.js y Git en tu servidor Ubuntu.
2.  **Sube el código**: Clona tu repo o sube los archivos.
3.  **Instala dependencias**: `npm install`
4.  **Configura el .env**: Crea el archivo `.env` con los datos reales.
5.  **Usa PM2** (Gestor de procesos) para que no se apague nunca:
    ```bash
    sudo npm install -g pm2
    pm2 start src/server.js --name "voice-bot"
    pm2 save
    pm2 startup
    ```
6.  **SSL y Dominio** (Opcional pero recomendado): Usa Nginx y Certbot para tener HTTPS seguro.

---

## 📂 Estructura del Proyecto

Para que no te pierdas, aquí está organizado todo:

```
/voice-bot/
├── src/
│   ├── config/          # ⚙️ Configuración y Prompts del sistema
│   ├── controllers/     # 🎮 Controladores de llamadas y rutas
│   ├── data/            # 📁 JSON DB (clients, leads, interactions)
│   ├── services/        # 🧠 Lógica de negocio (OpenAI, Smart Drip, Emails)
│   ├── utils/           # 🛠️ Herramientas (Logger, Validador)
│   └── server.js        # 🏁 Punto de entrada de Fastify
├── .env                 # 🔐 Tus secretos (¡No compartir!)
├── package.json         # 📦 Lista de librerías
└── README.md            # 📖 Este manual
```

---

Hecho con ❤️ y código por **Jules**. ¡Disfruta tu nuevo asistente! 🎉
