# 🤖 1WIRE AI COLD CALLER (SARAH)

## 1. IDENTIDAD Y PERSONALIDAD
* **Nombre:** Sarah (1Wire Assistant).
* **Ubicación:** Utah, USA (Equipo Local).
* **Voz:** OpenAI "Coral" (Tono casual, imperfecto, usa "um", "uh", "you know").
* **Objetivo:** Agendar "Evaluaciones Técnicas" (Technical Assessments) para Internet, VoIP e IT.
* **Regla de Oro:** Nunca decir la palabra "Chat". Siempre hablar de llamadas con especialistas humanos.

## 2. ARQUITECTURA TÉCNICA (Core V8)
* **Infraestructura:** AWS Server (Low RAM env) con **Swap Memory de 1GB** activa.
* **Motor:** Node.js + Express + WebSocket (OpenAI Realtime API).
* **Telefonía:** Twilio (Inbound/Outbound).
* **Estabilidad:** Código blindado contra errores de sintaxis y manejo de procesos "zombies" con PM2.
* **Latencia:** Ajuste de VAD (Voice Activity Detection) a **1500ms** para evitar interrumpir al usuario.
* **Cierre:** Retardo de **10 segundos** antes de cerrar el socket para permitir una despedida completa.

## 3. MOTOR DE LLAMADAS (Goteo Inteligente)
El bot no llama a lo loco. Usa una estrategia de "Smart Drip":
* **Base de Datos:** Lee `src/data/clients.json`.
* **Lógica de Selección:**
  1. Busca el primer contacto con `status: "PENDING"`.
  2. Lo marca inmediatamente como `status: "CALLED"` (para evitar duplicados matemáticos).
  3. Ejecuta la llamada.
  4. Espera a que termine esa llamada por completo antes de buscar el siguiente (Concurrency Lock).

* **Horario de Operación (Cron):**
  * **Mañana:** 9:30 AM - 11:30 AM (Mountain Time).
  * **Tarde:** 2:30 PM - 3:30 PM (Mountain Time).
  * *Nota:* Si una llamada está en curso cuando termina el horario, la termina respetuosamente, pero no inicia una nueva.

## 4. FLUJO DE CONVERSACIÓN (Script Estricto)
El bot sigue un guion de "Ingeniería Social" paso a paso. **Prohibido hacer dos preguntas seguidas.**

### Outbound (Cold Call)
1. **Gatekeeper Navigation:** Saluda y pregunta: *"¿Manejas tú la tecnología o pregunto por un Office Manager?"*
2. **Internet Hook:** Pregunta por cortes o lentitud (dolor). Ofrece Fibra Local vs Comcast.
3. **VoIP Pitch:** Pregunta si usan teléfonos viejos o nube. Ofrece comparativa.
4. **IT/MSP Pitch:** Pregunta si tienen IT in-house. Comparativa de precio: *"Otros cobran $100, nosotros $59"*.
5. **Cierre (The Yes):** Pide permiso para que un humano llame.

### Inbound (Recepción & Ventas)
* **Objetivo:** Convertir cada llamada en una venta o evaluación técnica.
* **Estrategia:** Escucha activa, pivote inmediato a soluciones (Internet, VoIP, IT), persuasión agresiva pero amable.

## 5. RECOLECCIÓN DE DATOS (La Trifecta)
Si el cliente dice "SÍ", Sarah entra en modo recolección paso a paso. No cuelga sin esto:
1. **Nombre del Contacto:** ¿Por quién preguntamos? (IT Manager/Dueño).
2. **Nombre de la Empresa:** Obligatorio para "ver el mapa de fibra".
3. **Verificación de Teléfono:** *"¿Es este número el mejor para llamar?"* (Crucial para distinguir fijos de celulares).
4. **Hora Exacta:** *"¿A qué hora mañana?"* (Puntualidad).

## 6. HERRAMIENTAS Y ACCIONES (Tools)
El bot tiene 3 herramientas conectadas a funciones JavaScript:

* `schedule_appointment`:
  * **Disparador:** Solo cuando tiene *Trifecta* + Hora.
  * **Acción:** Guarda en `src/data/leads.json` y envía Email de Éxito (Verde).

* `report_interaction`:
  * **Disparador:** Cliente no interesado, pide llamar luego, o buzón.
  * **Acción:** Guarda en `src/data/interactions.json` y envía Email de Reporte (Naranja).

* `end_call`:
  * **Disparador:** Final de la conversación.
  * **Acción:** Despide y corta la conexión tras 10s.

## 7. SISTEMA DE REPORTES (Mailer)
* **Idioma:** 100% Inglés.
* **Transporte:** Nodemailer (Gmail SMTP).
* **Contenido del Email:**
  * Asunto coloreado (Verde/Naranja).
  * **Comparativa de Teléfonos:** Muestra el CallerID de Twilio VS el Teléfono Confirmado verbalmente.
  * Detalles de la Cita y Necesidades detectadas.

## Configuración
Asegúrate de configurar las variables de entorno en un archivo `.env` o en tu plataforma de despliegue:
- `OPENAI_API_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `PUBLIC_URL`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
- `NOTIFICATION_EMAIL`
