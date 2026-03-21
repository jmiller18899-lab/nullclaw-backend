// NullClaw Mission Control Proxy v3.0.0

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration
app.use(cors());

// Rate limiting configuration
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // Limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Main endpoint
app.get('/', (req, res) => {
    res.send('Welcome to NullClaw Mission Control Proxy!');
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK' });
});

// Messages API endpoint
app.post('/api/messages', (req, res) => {
    const message = req.body.message;
    // Handle the message as needed
    res.status(200).send(`Message received: ${message}`);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});