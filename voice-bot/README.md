# 🤖 1WIRE AI COLD CALLER (SARAH) 📞

¡Bienvenido a tu **Voice Bot** de última generación! 🚀
Este proyecto implementa a Sarah, la asistente de 1Wire especializada en agendar Evaluaciones Técnicas para servicios de Internet, VoIP e IT. ¡Con una latencia mínima y voz súper natural usando el motor Realtime de OpenAI! 🗣️✨

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
*   **Identidad Estricta**: Sarah (1Wire Assistant) habla con tono casual y enfocado en ventas agresivas pero amigables.
*   **Motor Smart Drip**: Llamadas automatizadas (Outbound) respetando horarios estrictos (9:30-11:30 AM y 2:30-3:30 PM Mountain Time).
*   **Agenda Evaluaciones**: Gestiona reservas obteniendo obligatoriamente "La Trifecta" (Nombre, Empresa, Teléfono Confirmado y Hora) 📅.
*   **Reportes Automáticos**: Envía emails (Éxito verde o Reporte naranja) con detalles de la llamada 📝.
*   **Infraestructura Ligera**: Construido sobre Fastify optimizado para entornos de baja RAM.

---

## 🛠️ Requisitos Previos

Antes de empezar, asegúrate de tener:

*   **Node.js** (v18 o superior) instalado. [Descargar aquí](https://nodejs.org/)
*   Una cuenta en **Twilio** con un número de teléfono. [Registrarse](https://www.twilio.com/)
*   Una cuenta en **OpenAI** con acceso a la API (Key). [Obtener API Key](https://platform.openai.com/)
*   **Ngrok** (para pruebas locales de llamadas entrantes). [Descargar](https://ngrok.com/)

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

# 📧 Credenciales de Email (Nodemailer SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-app-password
REPORT_EMAIL_TO=reportes@tuempresa.com
```

---

## 💻 Ejecutar en Local

¡Hora de probarlo! Sigue estos pasos para ver la magia en tu computadora.

### 1. Levantar el Túnel (Ngrok) - Opcional para Inbound
En una terminal nueva, ejecuta:

```bash
ngrok http 3000
```
Copiar la URL que dice `Forwarding` y pégala en tu archivo `.env` en `PUBLIC_URL` y en Twilio.

### 2. Iniciar el Servidor
Para iniciar el servidor y ejecutar correctamente el bot con manejo limpio de procesos previos:

```bash
kill $(lsof -t -i :3000) 2>/dev/null || true && cd voice-bot && PORT=3000 npm run start
```

### 3. ¡Prueba la magia! 📱
*   **Outbound**: Añade números a `src/data/clients.json` con status "PENDING". El sistema los llamará automáticamente en los horarios permitidos.
*   **Inbound**: Llama a tu número de Twilio y Sarah te contestará lista para agendar.

---

## 🌐 Despliegue en Servidor (Ubuntu/VPS)

¿Listo para ir a producción? 🌍

1.  **Prepara el servidor**: Instala Node.js, PM2 y habilita 1GB de Swap Memory.
2.  **Sube el código**: Clona tu repo o sube los archivos.
3.  **Instala dependencias**: `npm install`
4.  **Configura el .env**: Crea el archivo `.env` con los datos reales.
5.  **Usa PM2** para mantenerlo corriendo:
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
│   ├── config/          # ⚙️ Configuración general y Prompts (Sarah Persona)
│   ├── controllers/     # 🎮 Controladores Fastify de llamadas
│   ├── data/            # 📁 Base de datos JSON (clients, leads, interactions)
│   ├── services/        # 🧠 Lógica de Realtime OpenAI, Smart Drip y Emails
│   ├── utils/           # 🛠️ Logger y Validador de Twilio
│   └── server.js        # 🏁 Punto de entrada (Fastify)
├── .env                 # 🔐 Secretos
├── package.json         # 📦 Dependencias
└── README.md            # 📖 Documentación
```

---

¡Disfruta tu nuevo asistente de ventas! 🎉
