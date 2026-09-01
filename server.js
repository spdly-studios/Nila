const http = require('node:http');
const { URL } = require('node:url');

const port = Number(process.env.PORT || 8787);
const snapServeBase = 'https://app.snapserve.ai/api';
const apiKey = process.env.SNAPSERVE_API_KEY;

function sendJson(response, status, body) {
    response.writeHead(status, {
        'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    });
    response.end(JSON.stringify(body));
}

async function proxy(response, target, options = {}) {
    if (!apiKey) return sendJson(response, 500, { error: 'SNAPSERVE_API_KEY is not configured on the relay.' });
    try {
        const upstream = await fetch(target, {
            ...options,
            headers: { Authorization: `Bearer ${apiKey}`, ...(options.headers || {}) }
        });
        const text = await upstream.text();
        response.writeHead(upstream.status, {
            'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Content-Type': upstream.headers.get('content-type') || 'application/json'
        });
        response.end(text);
    } catch (error) {
        sendJson(response, 502, { error: `SnapServe request failed: ${error.message}` });
    }
}

const server = http.createServer(async (request, response) => {
    if (request.method === 'GET' && (request.url === '/' || request.url === '/health')) {
        return sendJson(response, 200, { service: 'attendly-relay', status: 'ok' });
    }
    if (request.method === 'OPTIONS') {
        response.writeHead(204, {
            'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
        });
        return response.end();
    }
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === 'GET' && requestUrl.pathname.startsWith('/api/calls/')) {
        return proxy(response, `${snapServeBase}${requestUrl.pathname}`);
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/calls/outbound') {
        let body = '';
        for await (const chunk of request) body += chunk;
        return proxy(response, `${snapServeBase}/calls/outbound`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    }
    sendJson(response, 404, { error: 'Not found' });
});

server.listen(port, () => console.log(`Attendly relay listening on http://localhost:${port}`));
