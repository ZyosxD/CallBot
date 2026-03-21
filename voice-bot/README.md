# 🤖 1WIRE AI COLD CALLER (SARAH) 📞

¡Bienvenido a tu nuevo asistente **Sarah**, optimizada para ventas al 10000%! 🚀
Este proyecto es un asistente de voz inteligente capaz de atender llamadas telefónicas inbound y gestionar un Smart Drip de llamadas outbound, enfocado en agendar Evaluaciones Técnicas para servicios de Internet, VoIP e IT.

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

*   **Real-time Audio**: Conversaciones fluidas usando la API Realtime de OpenAI (Fastify + WebSockets).
*   **Voz Coral**: Utiliza la voz "Coral" para dar una sensación natural (usa "um", "uh").
*   **Smart Drip (Outbound)**: Generación y manejo automático de llamadas utilizando `clients.json` en los horarios de Mountain Time configurados.
*   **Gestión de Ventas**: Sigue un script estricto para generar "The Trifecta" e incrementar agendamientos.
*   **Reportes de Correo Electrónico**: Sistema integrado con Nodemailer que envía reportes en inglés con estados codificados por colores.
*   **Latencia**: Ajustada con un `silence_duration_ms` de 1500ms para nunca interrumpir.

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

---

## ⚙️ Configuración de Twilio

Para que Twilio sepa dónde enviar las llamadas, necesitamos configurar un Webhook para las inbound.

1.  Ve a tu **Consola de Twilio** > **Phone Numbers** > **Manage** > **Active numbers**.
2.  Haz clic en tu número de teléfono.
3.  Baja hasta la sección **Voice & Fax**.
4.  En **A CALL COMES IN**, selecciona **Webhook**.
5.  Aquí pondrás tu URL pública:
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

# 📞 Credenciales de Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1234567890

# 🌐 Tu URL pública (Ngrok o Dominio real)
PUBLIC_URL=https://tu-url-ngrok.ngrok-free.app

# ✉️ Correo electrónico
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-correo@gmail.com
SMTP_PASS=tu-contraseña-de-aplicación
NOTIFICATION_EMAIL=correo-destino@empresa.com
```

---

## 💻 Ejecutar en Local

¡Hora de probarlo! Sigue estos pasos para ver la magia en tu computadora.

### 1. Levantar el Túnel (Ngrok)
En una terminal nueva, ejecuta:

```bash
ngrok http 3000
```
Copia la URL segura y pégala en `PUBLIC_URL` y en la config de Twilio.

### 2. Iniciar el Servidor
En la terminal de tu proyecto, ejecuta:

```bash
npm run dev
```

---

## 🌐 Despliegue en Servidor (Ubuntu/VPS)

*   **Infraestructura Target:** AWS Server (Low RAM env) con **Swap Memory de 1GB** activa.

1.  Sube el código e instala las dependencias (`npm install`).
2.  Configura el `.env`.
3.  Usa PM2:
    ```bash
    pm2 start src/server.js --name "sarah-bot"
    pm2 save
    pm2 startup
    ```

---

## 📂 Estructura del Proyecto

```
/voice-bot/
├── src/
│   ├── config/          # Configuración y Prompts de Sarah
│   ├── controllers/     # Controladores Fastify y WebSocket
│   ├── services/        # Lógica: OpenAI, Smart Drip, Emails
│   ├── utils/           # Herramientas de logger y validación
│   └── data/            # Almacenamiento JSON (clients, leads, interactions)
│   └── server.js        # Punto de entrada
├── package.json
└── README.md
```

Hecho con ❤️ por **Jules**. ¡Disfruta vendiendo al 10000% con Sarah! 🎉
