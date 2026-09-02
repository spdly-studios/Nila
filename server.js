const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const port = Number(process.env.PORT || 8787);
const snapServeBase = 'https://app.snapserve.ai/api';
const apiKey = process.env.SNAPSERVE_API_KEY;
const webhookSecret = process.env.SNAPSERVE_WEBHOOK_SECRET;
const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
// Replace with a database in production; this keeps webhook results available for the running relay.
const callStore = new Map();
const attendanceStore = [];
const storeFile = path.join(process.env.DATA_DIR || __dirname, 'calls.json');
try { for (const record of JSON.parse(fs.readFileSync(storeFile, 'utf8'))) callStore.set(record.id, record); } catch { /* first run */ }
const attendanceFile = path.join(process.env.DATA_DIR || __dirname, 'attendance.json');
try { attendanceStore.push(...JSON.parse(fs.readFileSync(attendanceFile, 'utf8'))); } catch { /* first run */ }
function persistCalls() { fs.writeFileSync(storeFile, JSON.stringify([...callStore.values()], null, 2)); }
function persistAttendance() { fs.writeFileSync(attendanceFile, JSON.stringify(attendanceStore, null, 2)); }
function verifiedWebhook(headers, rawBody) {
    if (!webhookSecret) return true;
    const timestamp = headers['x-snapserve-timestamp'];
    const supplied = headers['x-snapserve-signature'] || '';
    if (!timestamp || !supplied) return false;
    const expected = `sha256=${crypto.createHmac('sha256', webhookSecret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
    return supplied.length === expected.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

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
    if (request.method === 'GET' && request.url === '/health') {
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
    if (request.method === 'GET' && requestUrl.pathname === '/api/attendance') return sendJson(response, 200, attendanceStore);
    if (request.method === 'POST' && requestUrl.pathname === '/api/attendance') {
        let body = ''; for await (const chunk of request) body += chunk;
        try { const record = JSON.parse(body || '{}'); if (!record.date || !Array.isArray(record.students)) return sendJson(response, 400, { error: 'date and students are required' }); attendanceStore.push(record); persistAttendance(); return sendJson(response, 201, record); }
        catch (error) { return sendJson(response, 400, { error: `Invalid attendance record: ${error.message}` }); }
    }
    if (request.method === 'GET' && !requestUrl.pathname.startsWith('/api/')) {
        const file = requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname.slice(1);
        const safe = path.normalize(file);
        if (!safe.startsWith('..') && !path.isAbsolute(safe)) {
            const filePath = path.join(__dirname, safe);
            try { const content = fs.readFileSync(filePath); const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/javascript'; response.writeHead(200, { 'Content-Type': type }); return response.end(content); } catch { /* continue to API 404 */ }
        }
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/calls/outbound') {
        let body = '';
        for await (const chunk of request) body += chunk;
        if (!apiKey) return sendJson(response, 500, { error: 'SNAPSERVE_API_KEY is not configured on the relay.' });
        try {
            const payload = JSON.parse(body || '{}');
            payload.webhookUrl ||= `${publicUrl || `http://${request.headers.host}`}/api/webhooks/snapserve`;
            const upstream = await fetch(`${snapServeBase}/calls/outbound`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const text = await upstream.text();
            if (!upstream.ok) return sendJson(response, upstream.status, { error: text });
            const call = JSON.parse(text);
            const id = call.id || call.callId;
            if (id) callStore.set(String(id), { id: String(id), status: 'queued', request: payload, createdAt: new Date().toISOString() });
            persistCalls();
            return sendJson(response, 202, { ...call, status: 'queued' });
        } catch (error) { return sendJson(response, 400, { error: `Invalid outbound call request: ${error.message}` }); }
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/webhooks/snapserve') {
        let body = '';
        for await (const chunk of request) body += chunk;
        if (!verifiedWebhook(request.headers, body)) return sendJson(response, 401, { error: 'Invalid SnapServe webhook signature.' });
        try {
            const event = JSON.parse(body || '{}');
            const data = event.data || event;
            const id = String(data.callId || data.id || data.call?.id || '');
            if (!id) return sendJson(response, 400, { error: 'Webhook payload has no call id.' });
            const details = await fetch(`${snapServeBase}/calls/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
            const record = details.ok ? await details.json() : event;
            callStore.set(id, { ...(callStore.get(id) || {}), ...record, webhook: event, updatedAt: new Date().toISOString() });
            persistCalls();
            return sendJson(response, 200, { received: true });
        } catch (error) { return sendJson(response, 400, { error: `Invalid webhook payload: ${error.message}` }); }
    }
    if (request.method === 'GET' && requestUrl.pathname.startsWith('/api/calls/')) {
        const id = requestUrl.pathname.split('/').pop();
        if (callStore.has(id)) return sendJson(response, 200, callStore.get(id));
        return proxy(response, `${snapServeBase}${requestUrl.pathname}`);
    }
    sendJson(response, 404, { error: 'Not found' });
});

server.listen(port, () => console.log(`Attendly relay listening on http://localhost:${port}`));
