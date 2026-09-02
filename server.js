const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const port = Number(process.env.PORT || 8787);
const snapServeBase = 'https://app.snapserve.ai/api';
const apiKey = process.env.SNAPSERVE_API_KEY;
const webhookSecret = process.env.SNAPSERVE_WEBHOOK_SECRET;
let aiEndpoint = process.env.AI_ENDPOINT || 'https://integrate.api.nvidia.com/v1/chat/completions';
const aiApiKey = process.env.AI_API_KEY;
let aiModel = process.env.AI_MODEL || 'meta/muse-glimmer-30b';
let aiTagModel = process.env.AI_TAG_MODEL || 'nemotron-3-embed-1b';
const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
// Replace with a database in production; this keeps webhook results available for the running relay.
const callStore = new Map();
process.on('uncaughtException', error => { console.error('[Attendly] uncaughtException', error); try { appendLog('process.uncaught_exception', { message: error.message, stack: error.stack }); } catch {} });
process.on('unhandledRejection', reason => { console.error('[Attendly] unhandledRejection', reason); try { appendLog('process.unhandled_rejection', { message: String(reason?.message || reason) }); } catch {} });
const attendanceStore = [];
const storeFile = path.join(process.env.DATA_DIR || __dirname, 'calls.json');
try { for (const record of JSON.parse(fs.readFileSync(storeFile, 'utf8'))) callStore.set(record.id, record); } catch { /* first run */ }
const attendanceFile = path.join(process.env.DATA_DIR || __dirname, 'attendance.json');
const logFile = path.join(process.env.DATA_DIR || __dirname, 'activity.log');
try { attendanceStore.push(...JSON.parse(fs.readFileSync(attendanceFile, 'utf8'))); } catch { /* first run */ }
function atomicWrite(file, value) { const temp = `${file}.tmp`; fs.writeFileSync(temp, value); fs.renameSync(temp, file); }
function persistCalls() { atomicWrite(storeFile, JSON.stringify([...callStore.values()], null, 2)); }
async function refreshCall(id, existing) {
    if (!apiKey) return existing;
    try {
        const headers = { Authorization: `Bearer ${apiKey}` };
        const get = async suffix => { const response = await fetch(`${snapServeBase}/calls/${encodeURIComponent(id)}${suffix}`, { headers }); return response.ok ? response.json() : null; };
        const getAgent = async agentId => { const response = await fetch(`${snapServeBase}/agents/${encodeURIComponent(agentId)}`, { headers }); return response.ok ? response.json() : null; };
        const latest = await get('');
        if (!latest) return existing;
        const [logs, disposition, memory, recording, agent] = await Promise.all([get('/logs'), get('/disposition'), get('/caller-memory'), get('/meeting-recording'), latest.agentId ? getAgent(latest.agentId) : null]);
        const variables = callVariables({ ...existing, ...latest });
        const merged = { ...existing, ...latest, identity: { studentName: variables.studentName || variables.name || existing.identity?.studentName || null, parentName: variables.parentName || variables.pname || existing.identity?.parentName || null, phone: variables.phone || existing.identity?.phone || latest.toNumber || latest.fromNumber || null }, related: { logs, disposition, callerMemory: memory, meetingRecording: recording, agent }, updatedAt: new Date().toISOString() };
        merged.aiAnalysis = await analyzeTranscriptV2(latest.transcript, existing);
        merged.aiAnalysis = ensureAnalysis(merged, merged.aiAnalysis);
        callStore.set(id, merged); return merged;
    } catch { return existing; }
}
function persistAttendance() { atomicWrite(attendanceFile, JSON.stringify(attendanceStore, null, 2)); }
function appendLog(type, data = {}) { fs.appendFileSync(logFile, JSON.stringify({ type, at: new Date().toISOString(), ...data }) + '\n'); }
function applySessionAI(headers) { aiEndpoint = headers['x-ai-endpoint'] || process.env.AI_ENDPOINT || 'https://integrate.api.nvidia.com/v1/chat/completions'; aiModel = headers['x-ai-model'] || process.env.AI_MODEL || 'meta/muse-glimmer-30b'; aiTagModel = headers['x-ai-tag-model'] || process.env.AI_TAG_MODEL || 'nemotron-3-embed-1b'; }
async function analyzeTranscript(transcript, existing = {}) {
    if (!aiEndpoint || !aiApiKey || !transcript) return existing.aiAnalysis || null;
    const hash = crypto.createHash('sha256').update(transcript).digest('hex');
    if (existing.aiAnalysis?.transcriptHash === hash && existing.aiAnalysis.model === aiModel) return existing.aiAnalysis;
    try { const response = await fetch(aiEndpoint, { method: 'POST', headers: { Authorization: `Bearer ${aiApiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: aiModel, temperature: 0.2, top_p: 0.95, max_tokens: 2048, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'You analyze a school absence call. Return JSON only with exactly: mainReason (a short 2-6 word factual label, not a sentence), tags (3 or fewer snake_case labels), confidence (0 to 1). Extract only what the parent actually said. Do not copy the call summary. If no reason is stated, use mainReason "No reason provided" and tag "no_reason_provided".' }, { role: 'user', content: `Identify the main absence reason from this complete transcript. Ignore greetings, agent instructions, caller memory, and unrelated names.\n\n${transcript}` }] }) }); if (!response.ok) throw new Error(`AI endpoint returned ${response.status}`); const body = await response.json(); const content = body.choices?.[0]?.message?.content || body.output_text || body.result || body; const result = typeof content === 'string' ? JSON.parse(content.replace(/^```json\s*|\s*```$/g, '')) : content; return { transcriptHash: hash, mainReason: String(result.mainReason || 'No reason provided'), tags: Array.isArray(result.tags) ? result.tags.map(tag => String(tag).toLowerCase().replace(/[^a-z0-9_]+/g, '_')).filter(Boolean).slice(0, 3) : [], confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)), model: aiModel, analyzedAt: new Date().toISOString() }; } catch (error) { appendLog('ai.analysis_error', { message: error.message, model: aiModel }); return existing.aiAnalysis || null; }
}
function callVariables(record) { let metadata = record.metadata; if (typeof metadata === 'string') { try { metadata = JSON.parse(metadata); } catch { metadata = null; } } return record.request?.variables || metadata?.callVariables || {}; }
function parentSpeech(transcript) { const source = String(transcript || ''); const parts = source.split(/(?=(?:agent|parent|customer|caller|user)\s*:)/i); const parent = parts.filter(line => /^(parent|customer|caller|user)\s*:/i.test(line)).map(line => line.replace(/^(parent|customer|caller|user)\s*:\s*/i, '').trim()).filter(Boolean); return parent.length ? parent.join('\n') : ''; }
async function analyzeTranscriptV2(transcript, existing = {}) {
    if (!aiApiKey || !transcript) return existing.aiAnalysis || null;
    const hash = crypto.createHash('sha256').update(transcript).digest('hex');
    if (existing.aiAnalysis?.transcriptHash === hash && existing.aiAnalysis.summaryModel === aiModel && existing.aiAnalysis.tagModel === aiTagModel) return existing.aiAnalysis;
    const speech = parentSpeech(transcript), request = async (model, instruction) => { const response = await fetch(aiEndpoint, { method: 'POST', headers: { Authorization: `Bearer ${aiApiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, temperature: 0.1, top_p: 0.95, max_tokens: 2048, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: instruction }, { role: 'user', content: speech }] }) }); if (!response.ok) throw new Error(`AI endpoint returned ${response.status}`); const body = await response.json(); const content = body.choices?.[0]?.message?.content || body.output_text || body.result || body; return typeof content === 'string' ? JSON.parse(content.replace(/^```json\s*|\s*```$/g, '')) : content; };
    try { const [summary, tags] = await Promise.all([request(aiModel, 'Summarize ONLY what the parent or caller said. Ignore every Agent line, greeting, prompt, caller memory, metadata, and inferred fact. Return JSON only: {"summary":"one concise factual sentence","mainReason":"short 2-6 word reason"}. If no absence reason was stated, use "No reason provided".'), request(aiTagModel, 'Extract tags ONLY from what the parent or caller said. Ignore Agent lines, metadata, caller memory, and inference. Return JSON only: {"tags":["up to 3 snake_case tags"]}. Use no_reason_provided if no absence reason was stated.')]); return { transcriptHash: hash, summary: String(summary.summary || 'No parent statement available.'), mainReason: String(summary.mainReason || 'No reason provided'), tags: Array.isArray(tags.tags) ? tags.tags.map(tag => String(tag).toLowerCase().replace(/[^a-z0-9_]+/g, '_')).filter(Boolean).slice(0, 3) : [], confidence: 0, summaryModel: aiModel, tagModel: aiTagModel, analyzedAt: new Date().toISOString() }; } catch (error) { appendLog('ai.analysis_error', { message: error.message, summaryModel: aiModel, tagModel: aiTagModel }); return existing.aiAnalysis || null; }
}
function fallbackAnalysis(record) { const text = `${record.callSummary || ''} ${record.dispositionResult?.summary || ''}`.toLowerCase(); const tags = []; if (/sick|ill|health|fever|hospital|doctor|medical/.test(text)) tags.push('health_issue'); if (/travel|outstation|trip|village/.test(text)) tags.push('travel'); if (/family|personal|function|wedding/.test(text)) tags.push('family_or_personal'); if (/transport|bus|traffic|vehicle/.test(text)) tags.push('transport'); if (/no reason|without a reason|reason.*not/.test(text) || !text.trim()) tags.push('no_reason_provided'); return { mainReason: record.callSummary || record.dispositionResult?.summary || 'Reason not available', tags, confidence: 0, source: 'fallback' }; }
function ensureAnalysis(record, analysis) { const speech = parentSpeech(record.transcript); return { ...(analysis || fallbackAnalysis(record)), summary: analysis?.summary || (speech ? speech.replace(/^(parent|customer|caller|user)\s*:\s*/i, '').trim().slice(0, 500) : 'Parent summary not available.'), mainReason: analysis?.mainReason || 'No reason provided', tags: Array.isArray(analysis?.tags) ? analysis.tags : [] }; }
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
    if (request.method === 'GET' && requestUrl.pathname === '/api/logs') {
        try { const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).slice(-500).map(line => JSON.parse(line)); return sendJson(response, 200, lines); } catch { return sendJson(response, 200, []); }
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/calls') {
        applySessionAI(request.headers);
        if (requestUrl.searchParams.get('refresh') === '1' && apiKey) {
            try { const upstream = await fetch(`${snapServeBase}/calls`, { headers: { Authorization: `Bearer ${apiKey}` } }); if (upstream.ok) { const body = await upstream.json(); const remote = Array.isArray(body) ? body : body.calls || body.data || []; remote.forEach(call => { const id = call.id || call.callId; if (id) callStore.set(String(id), { ...(callStore.get(String(id)) || {}), ...call, id: String(id) }); }); } } catch { /* retain local records */ }
        }
        const records = requestUrl.searchParams.get('refresh') === '1' ? await Promise.all([...callStore.values()].map(call => refreshCall(call.id, call))) : [...callStore.values()];
        persistCalls(); return sendJson(response, 200, records.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))));
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/attendance') return sendJson(response, 200, attendanceStore);
    if (request.method === 'POST' && requestUrl.pathname === '/api/attendance') {
        let body = ''; for await (const chunk of request) body += chunk;
        try { const record = JSON.parse(body || '{}'); if (!record.date || !Array.isArray(record.students)) return sendJson(response, 400, { error: 'date and students are required' }); record.id ||= crypto.randomUUID(); record.savedAt = new Date().toISOString(); attendanceStore.push(record); persistAttendance(); appendLog('attendance.saved', { id: record.id, date: record.date, className: record.className, studentCount: record.students.length }); return sendJson(response, 201, record); }
        catch (error) { appendLog('attendance.error', { message: error.message }); return sendJson(response, 400, { error: `Invalid attendance record: ${error.message}` }); }
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
            appendLog('call.queued', { id: id ? String(id) : null, studentName: payload.variables?.studentName || payload.variables?.name, parentName: payload.variables?.parentName || payload.variables?.pname });
            return sendJson(response, 202, { ...call, status: 'queued' });
        } catch (error) { appendLog('call.error', { message: error.message }); return sendJson(response, 400, { error: `Invalid outbound call request: ${error.message}` }); }
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
            appendLog('call.webhook_received', { id, event: event.event, status: data.status, hasTranscript: Boolean(data.transcript), hasSummary: Boolean(data.callSummary) });
            return sendJson(response, 200, { received: true });
        } catch (error) { return sendJson(response, 400, { error: `Invalid webhook payload: ${error.message}` }); }
    }
    if (request.method === 'POST' && requestUrl.pathname.match(/^\/api\/calls\/[^/]+\/analyze$/)) {
        applySessionAI(request.headers);
        const id = requestUrl.pathname.split('/')[3]; const existing = callStore.get(id);
        if (!existing) return sendJson(response, 404, { error: 'Call not found.' });
        const record = await refreshCall(id, existing); persistCalls(); appendLog('ai.analysis_manual', { id }); return sendJson(response, 200, record);
    }
    if (request.method === 'GET' && requestUrl.pathname.startsWith('/api/calls/')) {
        const id = requestUrl.pathname.split('/').pop();
        if (callStore.has(id)) return sendJson(response, 200, callStore.get(id));
        return proxy(response, `${snapServeBase}${requestUrl.pathname}`);
    }
    sendJson(response, 404, { error: 'Not found' });
});

server.listen(port, () => console.log(`Attendly relay listening on http://localhost:${port}`));
