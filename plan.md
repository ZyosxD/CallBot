1.  **Refactor Server from Express to Fastify + WebSockets:**
    *   Update `src/server.js` to use Fastify instead of Express.
    *   Register `@fastify/websocket` and `@fastify/formbody`.
    *   Initialize `startDrip()` after Fastify starts listening.
    *   Gracefully stop `stopDrip()` on server close.

2.  **Refactor Routing and Twilio Validation:**
    *   Update `src/controllers/router.js` to use Fastify syntax.
    *   Add Twilio validation using Fastify preHandler in `src/utils/twilioValidator.js`.

3.  **Implement Smart Drip Service:**
    *   Create `src/services/dripService.js`.
    *   Implement logic to read `clients.json`, check MT hours (9:30-11:30 & 14:30-15:30), select `status: "PENDING"`, update status to `CALLED`, and make Twilio `calls.create`.
    *   Handle concurrency locking (`activeCallSid`).

4.  **Update Call Controller:**
    *   Refactor `src/controllers/callController.js` for Fastify.
    *   Create `inboundCall` to handle Twilio inbound webhook (receptionist mode).
    *   Extract `callerId` correctly from `req.query.callerId` or `req.body.From`.
    *   Implement `handleWebSocket` using `@fastify/websocket` connection. Handle dynamic `markCallEnded` via `import()`.
    *   Handle `inboundStatus` webhook to release the drip lock.

5.  **Update OpenAI Realtime Service:**
    *   Refactor `src/services/openaiRealtime.js`.
    *   Configure VAD (`silence_duration_ms: 1500`).
    *   Configure persona using `SARAH_INBOUND` and `SARAH_OUTBOUND` prompts.
    *   Send `session.update` only after both WS and Twilio `start` are connected.
    *   Add Tools: `schedule_appointment`, `report_interaction`, `end_call`.
    *   `end_call`: 10-second `setTimeout` before closing socket.
    *   Properly handle hallucinated JSON in `handleFunctionCall`.

6.  **Create Prompts & System Instructions:**
    *   Update `src/config/prompts.js` to define "Sarah" as an aggressive salesperson for 1Wire (Internet, VoIP, IT).
    *   Include strictly prohibited actions (never say "Chat", no double questions).
    *   Implement the script flow (Gatekeeper, Internet, VoIP, IT, Close).

7.  **Implement Email & Lead Services:**
    *   Create `src/services/emailService.js` using Nodemailer (Green/Orange emails with CallerID vs Confirmed Phone).
    *   Update data services to write to `clients.json`, `leads.json`, `interactions.json`.

8.  **Complete Pre-commit Steps:**
    *   Run pre-commit instructions and verify everything is valid.

9.  **Submit Changes.**
