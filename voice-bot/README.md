# 🤖 1WIRE AI COLD CALLER (SARAH) 📞

¡Bienvenido al sistema **Sarah (1Wire Assistant)**! 🚀
Este proyecto es un bot inteligente dual: funciona tanto como Cold Caller (Outbound) como Recepcionista (Inbound). Todo está 100% enfocado en marketing y estrategias de ventas de los productos de 1Wire (Internet, VoIP, y servicios IT).

---

## 📋 Tabla de Contenidos

1. [🌟 Características Principales](#-características-principales)
2. [🛠️ Requisitos Previos](#-requisitos-previos)
3. [🚀 Instalación Paso a Paso](#-instalación-paso-a-paso)
4. [⚙️ Configuración de Twilio y Entorno](#-configuración-de-twilio-y-entorno)
5. [💻 Ejecutar en Local](#-ejecutar-en-local)
6. [🌐 Despliegue en Servidor](#-despliegue-en-servidor)

---

## 🌟 Características Principales

* **Doble Persona**: Outbound (Cold Calling Agresivo) e Inbound (Recepcionista persuasivo).
* **Motor Smart Drip**: Llamadas de salida automatizadas respetando horarios de 9:30-11:30 AM y 2:30-3:30 PM (Mountain Time).
* **La Trifecta**: No termina una llamada sin intentar capturar el Nombre, la Empresa, Confirmación Telefónica y la Hora Exacta para agendar "Technical Assessments".
* **Email de Reportes**: Alertas automáticas con resultados 🟢 SUCCESS o 🟠 REPORT.
* **Tolerancia a Fallos**: Basado en Fastify + WebSocket de alto rendimiento con mitigación para Low RAM (1GB Swap env) usando PM2.

---

## 🛠️ Requisitos Previos

* **Node.js** (v18 o superior)
* Cuenta en **Twilio**
* Cuenta en **OpenAI** (API Key para Realtime V1)
* Servidor SMTP (Ej: Gmail, Sendgrid)
* **Ngrok** (para pruebas locales).

---

## 🚀 Instalación Paso a Paso

1. Instala el proyecto:
```bash
cd voice-bot
npm install
```

2. Configura los datos de prueba (si vas a usar Drip Outbound):
En la carpeta `src/data/clients.json`, pon contactos con `status: "PENDING"`.

---

## ⚙️ Configuración de Twilio y Entorno

Crea un archivo llamado `.env` en la raíz de `voice-bot/`:

```ini
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
PORT=3000
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1234567890
PUBLIC_URL=https://tu-url-ngrok.ngrok-free.app

# Configuración de Mailer
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-correo@gmail.com
SMTP_PASS=tu-password-de-aplicacion
NOTIFICATION_EMAIL=gerencia@tu-empresa.com
```

* **Twilio Inbound**: Configura el Webhook en Twilio apuntando a `https://tu-url-ngrok.app/voice/inbound`.

---

## 💻 Ejecutar en Local

1. Levanta tu túnel Ngrok: `ngrok http 3000` y actualiza tu `.env`.
2. Inicia el bot evitando errores de puerto (EADDRINUSE):
```bash
npm run start
```
3. Llama al bot o deja que el Smart Drip empiece a llamar durante el horario operativo.

---

## 🌐 Despliegue en Servidor

Diseñado para infraestructura Low RAM + Swap usando PM2:

```bash
sudo npm install -g pm2
pm2 start src/server.js --name "sarah-bot"
pm2 save
pm2 startup
```