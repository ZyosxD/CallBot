# 🤖 1WIRE AI COLD CALLER (SARAH) 📞

¡Bienvenido a la versión de Inteligencia Artificial para Ventas de 1Wire! 🚀
Este proyecto es un asistente de voz inteligente, "Sarah", diseñado como vendedora y recepcionista agresiva para agendar "Evaluaciones Técnicas" (Technical Assessments).

---

## 📋 Tabla de Contenidos

1. [🌟 Características](#-características)
2. [🛠️ Arquitectura Técnica](#-arquitectura-técnica)
3. [🚀 Goteo Inteligente (Smart Drip)](#-goteo-inteligente)
4. [⚙️ Configuración](#-configuración)

---

## 🌟 Características

*   **Real-time Audio**: Conversaciones fluidas con latencia mínima de VAD ajustado a 1500ms usando la API Realtime de OpenAI.
*   **Agente de Ventas ("Coral")**: Persona con un tono casual y natural, enfocada al 1000% en ventas de Internet, VoIP y servicios IT.
*   **Recolección de Datos (La Trifecta)**: Sarah recopila activamente el Nombre, Nombre de la Empresa, Número de Teléfono verificado, y la Hora Exacta para la evaluación técnica.
*   **Reportes por Correo**: Sistema de notificaciones en inglés mediante SMTP usando íconos para reportes (🟢 Éxito, 🟠 Reporte sin Cita).

---

## 🛠️ Arquitectura Técnica

*   **Motor Principal:** Node.js + Fastify (V5) + WebSocket (OpenAI Realtime API).
*   **Infraestructura Target:** Servidor de bajo RAM con Swap Memory de 1GB activo.
*   **Telefonía:** Twilio (Inbound/Outbound).

---

## 🚀 Goteo Inteligente (Smart Drip)

Sarah no llama sin control. Usa una estrategia `Smart Drip` para realizar las llamadas de la lista de clientes.

*   Solo opera en horas de montaña (America/Denver): **Mañanas (9:30-11:30 AM)** y **Tardes (2:30-3:30 PM)**.
*   Llama uno por uno, cambiando el estatus de `PENDING` a `CALLED` antes de iniciar la llamada para evitar colisiones.
*   Solo iniciará la siguiente llamada cuando haya confirmado que Twilio liberó la línea.

---

## ⚙️ Configuración (.env)

Debes crear un archivo `.env` en la raíz del proyecto (`voice-bot/`) y configurar las siguientes variables:

```ini
# OpenAI
OPENAI_API_KEY=

# Puerto y URL
PORT=3000
PUBLIC_URL=https://tu-url.ngrok.app

# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# Sistema de Email (SMTP)
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
NOTIFICATION_EMAIL=
```

---

*Hecho con ❤️ en código Fastify por Jules.*
