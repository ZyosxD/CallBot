# 🤖 1WIRE AI COLD CALLER (SARAH) 📞

¡Bienvenido a **Sarah**, tu asistente de ventas y recepcionista inteligente! 🚀
Este proyecto implementa un bot de voz con **OpenAI Realtime API** y **Twilio** diseñado para realizar llamadas en frío (Outbound) y atender llamadas entrantes (Inbound) para 1Wire.

---

## 📋 Tabla de Contenidos

1. [🌟 Identidad y Personalidad](#-identidad-y-personalidad)
2. [🛠️ Arquitectura Técnica](#-arquitectura-técnica)
3. [🚀 Instalación Paso a Paso](#-instalación-paso-a-paso)
4. [⚙️ Configuración (.env)](#-configuración-env)
5. [💧 Motor de Llamadas (Smart Drip)](#-motor-de-llamadas-smart-drip)
6. [📊 Reportes y Emails](#-reportes-y-emails)
7. [📂 Estructura del Proyecto](#-estructura-del-proyecto)

---

## 🌟 Identidad y Personalidad

*   **Nombre:** Sarah (1Wire Assistant).
*   **Ubicación:** Utah, USA.
*   **Voz:** OpenAI "Coral".
*   **Objetivo:** Agendar "Evaluaciones Técnicas" para Internet, VoIP e IT.
*   **Regla de Oro:** Nunca decir "Chat". Siempre hablar de llamadas con especialistas humanos.

### Modos de Operación:
1.  **Outbound (Cold Caller):** Sigue un guion de Ingeniería Social estricto para navegar gatekeepers y cerrar citas.
2.  **Inbound (Receptionist):** Atiende llamadas entrantes con enfoque de Ventas/Marketing.

---

## 🛠️ Arquitectura Técnica

*   **Motor:** Node.js + Express + WebSocket (OpenAI Realtime API).
*   **Telefonía:** Twilio (Inbound/Outbound).
*   **VAD (Detección de Voz):** Configurado a **1500ms** para evitar interrupciones.
*   **Latencia:** WebSocket directo para mínima latencia.

---

## 🚀 Instalación Paso a Paso

### 1. Requisitos
*   Node.js (v18+)
*   Cuenta de Twilio
*   Cuenta de OpenAI (API Key)
*   Cuenta de Gmail (para envíos SMTP)

### 2. Instalación
```bash
cd voice-bot
npm install
```

### 3. Ejecutar
```bash
npm start
```

---

## ⚙️ Configuración (.env)

Crea un archivo `.env` en la carpeta `voice-bot/` con las siguientes variables:

```ini
# Configuración del Servidor
PORT=3000
PUBLIC_URL=https://tu-url-publica.com # (Sin barra al final)

# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1234567890

# OpenAI
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx

# Email (Reportes)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-app-password
NOTIFICATION_EMAIL=email-destino@ejemplo.com
```

---

## 💧 Motor de Llamadas (Smart Drip)

El bot utiliza una estrategia de "Smart Drip" para llamadas salientes:

*   **Base de Datos:** Lee `src/data/clients.json`.
*   **Horario (Mountain Time):**
    *   Mañana: 9:30 AM - 11:30 AM
    *   Tarde: 2:30 PM - 3:30 PM
*   **Lógica:**
    1.  Busca cliente con estado `PENDING`.
    2.  Marca como `CALLED`.
    3.  Llama y espera a que termine antes de seguir.
    4.  Si termina el horario, detiene las llamadas activas.

---

## 📊 Reportes y Emails

El sistema envía reportes automáticos vía Email:

*   🟢 **Éxito:** Cuando se agenda una cita (Trifecta conseguida).
*   🟠 **Reporte:** Interacción sin cita (No interesado, Buzón, etc).
*   **Datos:** Incluye comparación de CallerID vs Teléfono confirmado verbalmente.

---

## 📂 Estructura del Proyecto

```
/voice-bot/
├── src/
│   ├── config/          # ⚙️ Prompts y Configuración
│   ├── controllers/     # 🎮 Controladores (Call, Router)
│   ├── services/        # 🧠 Servicios (OpenAI, Drip, Email)
│   ├── utils/           # 🛠️ Logger, Validadores
│   ├── data/            # 💾 Base de datos JSON (Clients, Leads)
│   └── server.js        # 🏁 Servidor Express
├── .env                 # 🔐 Variables de entorno
├── package.json         # 📦 Dependencias
└── README.md            # 📖 Documentación
```

Hecho con ❤️ para **1Wire**.
