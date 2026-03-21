# 🤖 1WIRE AI COLD CALLER (SARAH) 📞

¡Bienvenido a **Sarah (1Wire Assistant)**! 🚀
Este proyecto es un asistente de ventas avanzado de llamadas en frío basado en IA diseñado para prospectar clientes para servicios de Internet, VoIP y MSP/IT. Operando en la infraestructura de AWS con Fastify y WebSockets de OpenAI Realtime, Sarah utiliza estrategias de marketing de élite, manejando el guion a la perfección para agendar "Evaluaciones Técnicas".

---

## 📋 Tabla de Contenidos

1. [🌟 Características](#-características)
2. [🛠️ Arquitectura Técnica](#-arquitectura-técnica)
3. [🚀 Instalación Paso a Paso](#-instalación-paso-a-paso)
4. [⚙️ Variables de Entorno (.env)](#-variables-de-entorno-env)
5. [📈 Goteo Inteligente (Smart Drip)](#-goteo-inteligente-smart-drip)
6. [📂 Estructura del Proyecto](#-estructura-del-proyecto)

---

## 🌟 Características

*   **IA de Ventas (Sarah)**: Usa el modelo Realtime GPT-4o con voz "Coral", operando como una especialista local de Utah, siempre dispuesta a agendar reuniones y NUNCA mencionando la palabra "chat".
*   **Bilingüe & Dinámico**: Modos \`Inbound\` (Recepcionista) y \`Outbound\` (Llamada en frío) con guiones estrictos (Gatekeeper, Internet Hook, VoIP Pitch, IT Pitch).
*   **Gestión de Datos (La Trifecta)**: Recolecta estrictamente Contacto, Nombre de la Empresa, Teléfono Confirmado y Hora Exacta antes de agendar.
*   **Sistema de Reportes Automático**: Envía resúmenes por correo electrónico (Nodemailer SMTP) con indicadores de colores (🟢 Éxito, 🟠 Reporte/Interacción).
*   **Dialer Inteligente**: Lógica "Smart Drip" que automatiza llamadas salientes durante los horarios de Mountain Time (9:30-11:30 AM y 2:30-3:30 PM).

---

## 🛠️ Arquitectura Técnica

*   **Plataforma**: Node.js + Fastify + @fastify/websocket.
*   **Telefonía**: Twilio Inbound/Outbound + TwiML inline.
*   **Estabilidad en AWS**: Adaptado para entornos de baja RAM (con Swap de 1GB).
*   **Voice Activity Detection (VAD)**: Configurado estrictamente a 1500ms para evitar interrupciones al prospecto.
*   **Cierre de Llamada**: Implementa un retardo de 10 segundos antes de cerrar el socket WebSocket para permitir despedidas fluidas.

---

## 🚀 Instalación Paso a Paso

1.  **Clonar y acceder al directorio:**
    \`\`\`bash
    cd voice-bot
    \`\`\`

2.  **Instalar dependencias:**
    \`\`\`bash
    npm install
    \`\`\`

3.  **Ejecutar el servidor localmente:**
    \`\`\`bash
    npm run dev
    # o bien
    node src/server.js
    \`\`\`

---

## ⚙️ Variables de Entorno (.env)

Crea un archivo \`.env\` en la raíz de \`voice-bot/\` con los siguientes datos:

\`\`\`ini
# 🤖 OpenAI
OPENAI_API_KEY=sk-proj-...

# 🚪 Servidor
PORT=3000
PUBLIC_URL=https://tu-ngrok.app

# 📞 Twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...

# 📧 SMTP Emails (Nodemailer)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-contraseña-de-aplicación
NOTIFY_TO_EMAIL=reportes@tuempresa.com
\`\`\`

---

## 📈 Goteo Inteligente (Smart Drip)

El bot no llama "a lo loco". Sigue una estrategia de cola:
1.  Busca contactos marcados como \`PENDING\` en \`src/data/clients.json\`.
2.  Cambia su estado a \`CALLED\` e inicia la llamada para evitar bloqueos matemáticos.
3.  Implementa un bloqueo transaccional (\`isCallActive\` y \`activeCallSid\`) para esperar a que Twilio reporte el estado de finalización antes de pasar a la siguiente persona.

---

## 📂 Estructura del Proyecto

\`\`\`
/voice-bot/
├── src/
│   ├── config/          # ⚙️ .env configs y Prompts Estrictos de IA.
│   ├── controllers/     # 🎮 Fastify Call Controllers y Enrutamiento (Twilio Webhooks).
│   ├── data/            # 📁 Base de datos JSON (Clients, Leads, Interactions).
│   ├── services/        # 🧠 Motor del Smart Drip, OpenAI Realtime Socket, Email Notifications.
│   ├── utils/           # 🛠️ Twilio Signature Validator, Winston Logger.
│   └── server.js        # 🏁 Main Fastify Server.
├── .env
├── package.json
└── README.md
\`\`\`
