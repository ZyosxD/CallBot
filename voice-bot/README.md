# 🤖 1WIRE AI COLD CALLER (SARAH)

Esta es la documentación oficial para **Sarah**, el asistente de voz de inteligencia artificial de 1Wire. Sarah funciona como una agente bilingüe (Inglés/Español) capaz de realizar llamadas en frío (Outbound) y actuar como recepcionista de ventas (Inbound).

## 🚀 Características Principales

*   **Identidad:** Sarah (1Wire Assistant), ubicada en Utah.
*   **Voz:** OpenAI "Coral" (Tono casual, imperfecto).
*   **Regla de Oro:** Nunca decir "Chat", siempre "Llamada" o "Hablar".
*   **Estrategia:** "Smart Drip" para llamadas salientes y "Venta Agresiva" para entrantes.
*   **Tecnología:** Node.js, Express, Twilio, OpenAI Realtime API.

## 🛠️ Instalación y Configuración

Sigue estos pasos para configurar el proyecto en tu entorno local o servidor.

### 1. Requisitos Previos

*   Node.js (v18+)
*   Cuenta de Twilio (SID, Auth Token, Número de Teléfono)
*   Cuenta de OpenAI (API Key con acceso a Realtime API)
*   Servidor SMTP (para envío de reportes)

### 2. Instalación de Dependencias

Ejecuta el siguiente comando en la terminal:

```bash
npm install
```

### 3. Configuración de Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto con el siguiente contenido:

```env
PORT=3000
PUBLIC_URL=https://tu-url-publica.com
TWILIO_ACCOUNT_SID=tu_sid
TWILIO_AUTH_TOKEN=tu_token
TWILIO_PHONE_NUMBER=tu_numero_twilio
OPENAI_API_KEY=tu_openai_key
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu_email@gmail.com
SMTP_PASS=tu_password_app
NOTIFICATION_EMAIL=admin@1wire.com
```

### 4. Base de Datos (JSON)

El sistema utiliza archivos JSON para gestionar clientes y leads:

*   `clients.json`: Lista de clientes pendientes por llamar via "Smart Drip".
*   `leads.json`: Almacena las citas agendadas exitosamente.
*   `interactions.json`: Registro de todas las interacciones reportadas.

**Ejemplo de `clients.json`:**

```json
[
  {
    "id": 1,
    "name": "Empresa A",
    "phone": "+15551234567",
    "status": "PENDING"
  }
]
```

## 📞 Funcionamiento

### 🔄 Llamadas Salientes (Outbound - Smart Drip)

El sistema ejecuta automáticamente llamadas en horarios específicos (Mountain Time):

*   **Mañana:** 09:30 AM - 11:30 AM
*   **Tarde:** 02:30 PM - 03:30 PM

**Lógica:**
1.  Busca un cliente con `status: "PENDING"`.
2.  Marca como `CALLED`.
3.  Inicia la llamada.
4.  Espera a que termine para iniciar la siguiente.

### 📥 Llamadas Entrantes (Inbound - Sales Receptionist)

Cualquier llamada al número de Twilio será atendida por Sarah con una personalidad de "Recepcionista de Ventas".

*   **Objetivo:** Vender productos y servicios de 0 a 100.
*   **Estrategia:** Identificar necesidades, agitar el dolor, presentar solución 1Wire, cerrar venta/cita.

## 📧 Reportes y Notificaciones

El sistema envía correos electrónicos automáticos:

*   🟢 **Éxito:** Cuando se agenda una cita (Trifecta + Hora).
*   🟠 **Reporte:** Cuando el cliente no está interesado o pide llamar luego.

## 📂 Estructura del Proyecto

```
voice-bot/
├── src/
│   ├── config/         # Configuración y Prompts
│   ├── controllers/    # Controladores de llamadas y WebSocket
│   ├── services/       # Lógica de negocio (OpenAI, Email, Drip, Scheduler)
│   ├── utils/          # Utilidades (Logger, EventBus)
│   └── server.js       # Punto de entrada
├── clients.json        # Base de datos de clientes
├── leads.json          # Base de datos de leads
└── package.json
```

---

*Documentación generada por Jules (AI Engineer).*
