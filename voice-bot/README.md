# 🤖 1WIRE AI COLD CALLER (SARAH) 📞

¡Bienvenido a tu **Voice Bot** de última generación! 🚀
Este proyecto implementa a Sarah, tu asistente de inteligencia artificial para llamadas en frío enfocada en ventas de servicios de Internet, VoIP e IT para agendar *Evaluaciones Técnicas*.

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
*   **Motor Smart Drip**: Llamadas automáticas a prospectos basadas en ventanas de tiempo específicas.
*   **Bilingüe**: Detecta y habla Español 🇪🇸 e Inglés 🇺🇸 automáticamente con voz natural ("Coral").
*   **Reportes en Tiempo Real**: Envía correos con la Trifecta de datos y verifica inconsistencias con el CallerID.
*   **Gestión Segura**: Prevención de procesos duplicados en despliegues con bajos recursos (1GB Swap / PM2).

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

Para que Twilio sepa dónde enviar las llamadas Inbound, necesitas configurar un Webhook.

1.  Ve a tu **Consola de Twilio** > **Phone Numbers** > **Manage** > **Active numbers**.
2.  Haz clic en tu número de teléfono.
3.  En **A CALL COMES IN**, selecciona **Webhook**.
4.  Pondrás tu URL pública con la ruta `/voice/inbound` (ej: `https://tu-url-ngrok.app/voice/inbound`).
5.  **IMPORTANTE**: Asegúrate de que sea `HTTP POST`.
6.  ¡Guarda los cambios! 💾

---

## 🔑 Variables de Entorno (.env)

Crea un archivo `.env` en la raíz del proyecto (`voice-bot/`) usando estas variables:

```ini
# 🤖 Tu clave de OpenAI
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx

# 🚪 Puerto del servidor (por defecto 3000)
PORT=3000

# 📞 Credenciales de Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1234567890

# 🌐 Tu URL pública (Ngrok o Dominio real - sin barra al final)
PUBLIC_URL=https://tu-url-ngrok.ngrok-free.app

# 📧 SMTP y Reportes (Emailer)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-correo@gmail.com
SMTP_PASS=tu-contraseña-de-aplicacion
NOTIFICATION_EMAIL=notificaciones@tu-empresa.com
```

---

## 💻 Ejecutar en Local

### 1. Levantar el Túnel (Ngrok)
En una terminal nueva, ejecuta:

```bash
ngrok http 3000
```
Pega la URL de Ngrok en tu archivo `.env` bajo `PUBLIC_URL`.

### 2. Iniciar el Servidor
```bash
npm run dev
```

El motor **Smart Drip** iniciará automáticamente y buscará clientes `PENDING` en `src/data/clients.json` durante horas de oficina (Mountain Time).

---

## 🌐 Despliegue en Servidor (Ubuntu/VPS)

Recomendado usar en entornos de bajos recursos con AWS, habilitando un **Swap de 1GB** mínimo para evitar crashes en Node.js.

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
│   ├── config/          # Configuración y Prompts de SARAH
│   ├── controllers/     # Controladores Fastify
│   ├── data/            # JSON para Leads, Clientes e Interacciones
│   ├── services/        # OpenAI, Smart Drip y Reportes de Email
│   ├── utils/           # Logger y Validadores
│   └── server.js        # Archivo Core Fastify
├── .env                 # Variables de Entorno
├── package.json         # Dependencias
└── README.md            # Documentación
```
