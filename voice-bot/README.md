# 🤖 1Wire AI Cold Caller (Sarah) 📞

¡Hola! Soy **Sarah**, tu asistente virtual basada en **Utah, USA**. 🏔️
Mi misión es agendar **Evaluaciones Técnicas** (Technical Assessments) para Internet, VoIP e IT. 💻📞

---

## 📋 Identidad y Reglas de Oro

*   **Nombre:** Sarah (1Wire Assistant)
*   **Voz:** OpenAI "Coral" (Casual, imperfecta, usa "um", "uh")
*   **Ubicación:** Utah (Equipo Local)
*   **Regla #1:** 🚫 **NUNCA DIGAS "CHAT"**. Siempre habla de "llamadas" o "hablar".

---

## 🚀 Arquitectura Técnica (Core V8)

*   **Motor:** Node.js + Fastify ⚡
*   **Conexión:** WebSocket (OpenAI Realtime API) 🔗
*   **Telefonía:** Twilio (Inbound/Outbound) ☎️
*   **Estrategia:** Smart Drip (Goteo Inteligente) 💧
*   **Latencia VAD:** 1500ms (Para no interrumpir) ⏳

---

## 🛠️ Instalación y Configuración

### 1. Requisitos
*   Node.js v18+ 🟢
*   Cuenta de Twilio (SID, Token, Phone Number) 📱
*   Cuenta de OpenAI (API Key) 🔑
*   Servidor SMTP (Gmail, etc.) para reportes 📧

### 2. Instalación
```bash
cd voice-bot
npm install
```

### 3. Configuración (.env)
Crea un archivo `.env` en la raíz con tus credenciales:

```ini
# Servidor
PORT=3000
PUBLIC_URL=https://tu-url-publica.ngrok-free.app

# OpenAI
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx

# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+18015550100

# Email (Reportes)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-app-password
NOTIFICATION_EMAIL=jefe@1wire.com
```

### 4. Ejecutar
```bash
npm start
```
¡El servidor iniciará y el **Scheduler** verificará si es hora de llamar! ⏰

---

## 💧 Motor de Llamadas (Smart Drip)

El bot opera automáticamente en horarios de Mountain Time (Utah):
*   ☀️ **Mañana:** 09:30 AM - 11:30 AM
*   🌤️ **Tarde:** 02:30 PM - 03:30 PM

**Lógica de Goteo:**
1.  Busca en `clients.json` el primer `PENDING`.
2.  Marca como `CALLED`.
3.  Llama. 📞
4.  Espera a que termine. 🛑
5.  Repite. 🔁

---

## 📂 Archivos de Datos

Los datos se gestionan automáticamente en la raíz:
*   `clients.json`: Lista de clientes a llamar.
*   `leads.json`: ✅ Citas agendadas (Éxito).
*   `interactions.json`: 🔸 Registro de todas las llamadas.

---

## 📧 Reportes Automáticos

*   ✅ **Verde:** ¡Cita Agendada! (Detalles de contacto, hora, empresa).
*   🔸 **Naranja:** Reporte de Interacción (No interesado, Buzón, etc.).

---

Hecho con ❤️ por **Jules**.
