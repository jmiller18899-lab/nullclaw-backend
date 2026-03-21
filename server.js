// NullClaw Mission Control Proxy v3.0.0 code

const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());

// Your API endpoints go here
app.get('/', (req, res) => {
    res.send('Hello from NullClaw Mission Control Proxy!');
});

wss.on('connection', (ws) => {
    console.log('New client connected');
    ws.on('message', (message) => {
        console.log('Received:', message);
        ws.send(`Echo: ${message}`);
    });
    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

// Handle shutdown gracefully
process.on('SIGINT', () => {
    console.log('Shutting down...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
