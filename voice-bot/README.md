# 🤖 Voice Bot con OpenAI Realtime & Twilio 📞

¡Bienvenido a tu **Voice Bot** de última generación! 🚀
Este proyecto es un asistente de voz inteligente capaz de atender llamadas telefónicas en tiempo real, actuar como agente de ventas agresivo (Sarah), generar leads (Evaluaciones Técnicas) y mandar reportes por email. ¡Todo con una latencia mínima y voz súper natural usando el modelo *coral* de OpenAI! 🗣️✨

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
*   **Doble Modo de Operación**: Modo Inbound (Recepcionista) y Modo Outbound (Llamadas en frío / Cold Caller).
*   **Estrategia "Smart Drip"**: Llama automáticamente a clientes potenciales dentro de horarios operativos (Mountain Time).
*   **Recolección "The Trifecta"**: Obliga a recopilar Nombre de Contacto, Empresa y Teléfono Confirmado antes de generar una cita.
*   **Reportes por Email**: Manda emails (Verdes 🟢 y Naranjas 🟠) de éxito y reporte con la comparación de números de teléfono.

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

Para que Twilio sepa dónde enviar las llamadas, necesitamos configurar un Webhook.

1.  Ve a tu **Consola de Twilio** > **Phone Numbers** > **Manage** > **Active numbers**.
2.  Haz clic en tu número de teléfono.
3.  Baja hasta la sección **Voice & Fax**.
4.  En **A CALL COMES IN**, selecciona **Webhook**.
5.  Aquí pondrás tu URL pública.
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
# No olvides incluir 'https://' y sin barra al final
PUBLIC_URL=https://tu-url-ngrok.ngrok-free.app

# 📧 SMTP para Reportes (Ejemplo con Gmail)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tu-correo@gmail.com
SMTP_PASS=tu-contraseña-de-aplicación
EMAIL_FROM="1Wire Assistant" <tu-correo@gmail.com>
EMAIL_TO=reportes@tuempresa.com
```

---

## 💻 Ejecutar en Local

¡Hora de probarlo! Sigue estos pasos para ver la magia en tu computadora.

### 1. Levantar el Túnel (Ngrok)
En una terminal nueva, ejecuta:

```bash
ngrok http 3000
```
Copia la URL que dice `Forwarding`.

👉 **Pega esta URL en tu archivo `.env` en `PUBLIC_URL`.**
👉 **Pega esta URL + `/voice/inbound` en tu configuración de Twilio.**

### 2. Iniciar el Servidor
En la terminal de tu proyecto, ejecuta:

```bash
npm run dev
```

### 3. ¡Prueba Inbound y Outbound! 📱
*   **Inbound**: Llama a tu número de Twilio. ¡Sarah (Recepcionista) contestará buscando agendar una Evaluación Técnica!
*   **Outbound**: Añade números a `src/data/clients.json` con `status: "PENDING"`. El Smart Drip los llamará automáticamente dentro del horario operativo (9:30-11:30 AM y 2:30-3:30 PM Mountain Time).

---

## 🌐 Despliegue en Servidor (Ubuntu/VPS)

¿Listo para ir a producción? 🌍

1.  **Sube el código**: Clona tu repo o sube los archivos.
2.  **Instala dependencias**: `npm install`
3.  **Configura el .env**: Crea el archivo `.env` con los datos reales.
4.  **Usa PM2**:
    ```bash
    sudo npm install -g pm2
    pm2 start src/server.js --name "voice-bot"
    pm2 save
    pm2 startup
    ```
5.  *Nota:* La arquitectura asume Swap de 1GB activo para Low RAM envs.

---

## 📂 Estructura del Proyecto

```
/voice-bot/
├── src/
│   ├── config/          # ⚙️ Configuración y Prompts de SARAH
│   ├── controllers/     # 🎮 Fastify router y Call Controller
│   ├── services/        # 🧠 Drip Engine, OpenAI API, Emails
│   ├── utils/           # 🛠️ Logger y Validador de Twilio
│   ├── data/            # 📁 JSON stores para clients, leads e interactions
│   └── server.js        # 🏁 Entrypoint de Fastify
├── .env                 # 🔐 Secretos
├── package.json         # 📦 Dependencias
└── README.md            # 📖 Documentación
```

Hecho con ❤️ y código por **Jules**. ¡Disfruta tu nuevo asistente de ventas! 🎉
