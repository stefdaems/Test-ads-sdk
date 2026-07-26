/**
 * broker.js — message broker layer for the device harness.
 *
 * Devices and the manager never talk to each other directly: they are both
 * clients of an MQTT message broker. This removes the requirement for a direct,
 * routable link from the manager to each device (which cannot be guaranteed on
 * real TV / mobile networks behind NAT or captive portals) — every party only
 * needs an *outbound* connection to the broker.
 *
 * By default the manager starts an embedded MQTT broker (aedes) so the whole
 * system is self-contained and runnable with `npm start`. It listens on:
 *
 *   - plain MQTT over TCP  (for Node clients / native devices)         MQTT_PORT
 *   - MQTT over WebSocket  (for browser devices, path `/mqtt`)         HTTP server
 *
 * To use an external/shared broker instead (e.g. a cloud MQTT service), set
 * `MQTT_URL` — the embedded broker is then skipped and the manager simply
 * connects to that broker as a client, exactly like the devices do.
 */

'use strict';

const net = require('net');
const { Aedes } = require('aedes');
const { createWebSocketStream, WebSocketServer } = require('ws');

/**
 * Start the embedded MQTT broker and attach a WebSocket listener to an existing
 * HTTP server so browser devices can reach it.
 *
 * @param {import('http').Server} httpServer  HTTP server to attach `/mqtt` to.
 * @param {object} [opts]
 * @param {number} [opts.mqttPort]  TCP port for native/Node MQTT clients.
 * @param {string} [opts.host]      Bind address for the TCP listener.
 * @param {string} [opts.wsPath]    WebSocket path browsers connect to.
 * @returns {Promise<{broker: object, tcpServer: import('net').Server, close: Function}>}
 */
async function startEmbeddedBroker(httpServer, opts = {}) {
  const mqttPort = opts.mqttPort;
  const host = opts.host || '0.0.0.0';
  const wsPath = opts.wsPath || '/mqtt';

  const broker = await Aedes.createBroker();

  // Native / Node clients: plain MQTT over TCP.
  const tcpServer = net.createServer(broker.handle);
  await new Promise((resolve, reject) => {
    tcpServer.once('error', reject);
    tcpServer.listen(mqttPort, host, () => { tcpServer.removeListener('error', reject); resolve(); });
  });

  // Browser clients: MQTT over WebSocket on the shared HTTP server.
  const wss = new WebSocketServer({ server: httpServer, path: wsPath });
  wss.on('connection', (conn) => {
    const stream = createWebSocketStream(conn);
    stream.on('error', () => {});
    broker.handle(stream);
  });

  const close = () => new Promise((resolve) => {
    wss.close(() => tcpServer.close(() => broker.close(resolve)));
  });

  return { broker, tcpServer, wss, close };
}

module.exports = { startEmbeddedBroker };
