# 🤖 1WIRE AI COLD CALLER (SARAH) 📞

¡Bienvenido a tu **Voice Bot** de última generación! 🚀
Este proyecto es un asistente de voz inteligente (Sarah) capaz de atender llamadas telefónicas inbound y realizar llamadas outbound en tiempo real, hablar en inglés, y agendar Evaluaciones Técnicas.

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
*   **Inglés Fluido**: Personalidad de "Sarah", vendedora agresiva de Utah.
*   **Goteo Inteligente (Smart Drip)**: Motor automatizado de llamadas salientes que respeta horarios.
*   **Agenda Citas**: Gestiona reservas para evaluaciones técnicas (Trifecta).
*   **Reportes Email**: Notificaciones en tiempo real al agendar o reportar llamadas.

---

## 🛠️ Requisitos Previos

Antes de empezar, asegúrate de tener:

*   **Node.js** (v18 o superior) instalado. [Descargar aquí](https://nodejs.org/)
*   Una cuenta en **Twilio** con un número de teléfono. [Registrarse](https://www.twilio.com/)
*   Una cuenta en **OpenAI** con acceso a la API (Key). [Obtener API Key](https://platform.openai.com/)
*   Cuenta de correo SMTP para alertas.

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
2.  En **A CALL COMES IN**, selecciona **Webhook**.
3.  Pon tu URL pública, ej: `https://tu-url-ngrok.app/voice/inbound`

---

## 🔑 Variables de Entorno (.env)

Crea un archivo llamado `.env` en la raíz del proyecto (`voice-bot/`).

```ini
# OpenAI
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx

# Puerto
PORT=3000

# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1234567890

# URL pública (Ngrok o Dominio real)
PUBLIC_URL=https://tu-url.app

# Correo (Reportes)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-correo@gmail.com
SMTP_PASS=tu-clave-app
NOTIFICATION_EMAIL=destino@gmail.com
```

---

## 💻 Ejecutar en Local

```bash
npm run dev
```

---

Hecho con ❤️ y código por **Jules**. ¡Disfruta tu nuevo asistente! 🎉
