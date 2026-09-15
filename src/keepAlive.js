import https from 'https';
import http from 'http';

export const keepServerAlive = (url) => {
    if (!url) return;

    const protocol = url.startsWith('https') ? https : http;

    // Render sleeps after 15 mins of inactivity. We ping every 14 mins.
    const interval = 14 * 60 * 1000;

    setInterval(() => {
        protocol.get(url, (res) => {
            console.log(`[Keep-Alive] Pinged server at ${new Date().toLocaleTimeString()} - Status: ${res.statusCode}`);
        }).on('error', (err) => {
            console.error('[Keep-Alive] Error pinging server:', err.message);
        });
    }, interval);
};