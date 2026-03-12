# 🤖 1WIRE AI COLD CALLER (SARAH) 📞

¡Bienvenido al **Voice Bot "Sarah"** de 1Wire! 🚀
Este proyecto es un asistente de voz inteligente diseñado específicamente para agendar **"Evaluaciones Técnicas" (Technical Assessments)** de Internet, VoIP y servicios IT. Usa la API Realtime de OpenAI y Twilio para interactuar por teléfono en tiempo real con una latencia casi nula, voz súper natural y cero palabras prohibidas como "Chat". 🗣️✨

---

## 📋 Tabla de Contenidos

1. [🌟 Características Clave](#-características-clave)
2. [🛠️ Arquitectura Técnica](#️-arquitectura-técnica)
3. [🚀 Requisitos Previos e Instalación](#-requisitos-previos-e-instalación)
4. [⚙️ Variables de Entorno (.env)](#️-variables-de-entorno-env)
5. [📈 Motor Inteligente de Goteo (Smart Drip)](#-motor-inteligente-de-goteo-smart-drip)
6. [💻 Ejecutar en Local](#-ejecutar-en-local)
7. [🌐 Despliegue en Producción (PM2/AWS)](#-despliegue-en-producción-pm2aws)
8. [📂 Estructura del Proyecto](#-estructura-del-proyecto)

---

## 🌟 Características Clave

*   **Identidad**: Sarah (1Wire Assistant). Ubicada en Utah, USA.
*   **Voz**: OpenAI "Coral". Natural, imperfecta (usa "um", "uh", "you know").
*   **Objetivo**: Realizar llamadas de Ingeniería Social, obtener "El SÍ" para una cita y recolectar la **Trifecta**.
*   **Regla de Oro**: Nunca dice la palabra "Chat".
*   **Gestión Bilingüe**: Habla y entiende a la perfección Español 🇪🇸 e Inglés 🇺🇸 adaptándose al prospecto al instante.

---

## 🛠️ Arquitectura Técnica

*   **Entorno**: Diseñado para baja RAM en AWS, requiere **1GB de Swap Memory** y gestor de procesos `pm2` para evitar caídas y matar procesos "zombies".
*   **Stack**: Node.js + Fastify + WebSocket (API Realtime OpenAI).
*   **Integración**: WebSockets nativos puenteando el Media Stream de Twilio y el Realtime API. No usa Express ni plugins antiguos.
*   **Detección de Interrupción (VAD)**: Ajustado a **1500ms** de latencia de silencio para no pisar la voz del usuario.
*   **Despedida**: 10 segundos de cortesía (`setTimeout`) post-conversación para finalizar y cortar la conexión respetuosamente.

---

## 🚀 Requisitos Previos e Instalación

### Requisitos

*   **Node.js** v18 o superior.
*   Cuenta de **Twilio** (Account SID, Auth Token y un Número habilitado para Inbound/Outbound).
*   **OpenAI API Key** (Acceso a GPT-4o-Realtime).
*   Cuenta de Email SMTP para enviar reportes (Recomendado Gmail App Passwords).

### Instalación

```bash
cd voice-bot
npm install
```

---

## ⚙️ Variables de Entorno (.env)

Crea un archivo llamado `.env` en la raíz del proyecto (`voice-bot/`).

```ini
# 🤖 Clave de OpenAI
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx

# 🚪 Puerto del servidor (por defecto 3000)
PORT=3000

# 📞 Credenciales de Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1234567890

# 🌐 URL Pública (Tu dominio HTTPS o ngrok, sin barra al final)
PUBLIC_URL=https://tu-url-produccion.com

# 📧 Configuración de Email SMTP (Para Envío de Reportes)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-password-de-aplicacion

# 📥 Email de Destino para Alertas
NOTIFICATION_EMAIL=gerente@1wire.com
```

---

## 📈 Motor Inteligente de Goteo (Smart Drip)

Sarah no llama "a lo loco". Usa un sistema de **Smart Drip** (Goteo Inteligente):

1.  **Orquestador**: Lee `src/data/clients.json` buscando prospectos con `status: "PENDING"`.
2.  **Bloqueo**: Apenas encuentra uno, lo marca como `CALLED` antes de iniciar la llamada y no inicia otra hasta que el Twilio Callback reciba un estado `completed` o `failed`.
3.  **Cron de Operación**:
    *   Mañana: 9:30 AM - 11:30 AM (Mountain Time / Denver)
    *   Tarde: 2:30 PM - 3:30 PM (Mountain Time / Denver)
4.  Si se acaba el horario y hay una llamada activa, espera a que termine y bloquea la cola.

### Archivos de Datos (JSON)

*   `src/data/clients.json`: Tu lista de Outbound a marcar.
*   `src/data/leads.json`: Aquí se registran los éxitos (La Trifecta + Hora de la cita). Dispara correo **🟢 VERDE**.
*   `src/data/interactions.json`: Aquí se registran buzones y objeciones. Dispara correo **🟠 NARANJA**.

---

## 💻 Ejecutar en Local

Si estás probando el bot:

1.  Abre ngrok:
    ```bash
    ngrok http 3000
    ```
2.  Copia la URL a `PUBLIC_URL` en tu archivo `.env`.
3.  Pon esa misma URL seguida de `/voice/inbound` en el Webhook de Twilio para probar llamadas entrantes.
4.  Inicia el servidor en Fastify:
    ```bash
    npm start
    ```
    *Si `PUBLIC_URL` no está vacío, el Smart Drip empezará a llamar si es el horario correcto.*

---

## 🌐 Despliegue en Producción (PM2/AWS)

Sarah está diseñada para correr en AWS permanentemente.

```bash
# Instala PM2 globalmente
npm install -g pm2

# Lanza la app blindada
pm2 start src/server.js --name "sarah-bot"

# Guarda el estado
pm2 save
pm2 startup
```

Asegúrate de configurar **1GB de Swap Memory** en la instancia EC2 para que los workers de VAD/WebSocket no se asfixien con la RAM.

---

## 📂 Estructura del Proyecto

```
/voice-bot/
├── src/
│   ├── config/          # ⚙️ variables, puertos, prompts (SARAH_INBOUND/OUTBOUND)
│   ├── controllers/     # 🎮 WebSockets y Callbacks de Twilio (Fastify)
│   ├── data/            # 🗃️ Base de Datos en JSON (clients, leads, interactions)
│   ├── services/        # 🧠 OpenAI Realtime, Nodemailer (Reportes), Smart Drip Engine
│   ├── utils/           # 🛠️ Logger de Winston, Validador de Firmas de Twilio
│   └── server.js        # 🏁 Entrypoint de Fastify + Plugins
├── .env                 # 🔐 Secretos
├── package.json         # 📦 NPM
└── README.md            # 📖 Este Manual
```

---

Hecho por **Jules**. Let's schedule those Technical Assessments! 📞
