const https = require('https');

const OWNER = process.env.GITHUB_OWNER || 'a01413131-coder';
const REPO = process.env.GITHUB_REPO || 'Cooper-logistics';
const BRANCH = process.env.GITHUB_BRANCH || 'data';
const FILE_PATH = process.env.GITHUB_DATA_PATH || 'data/citas.json';
const TOKEN = (process.env.GITHUB_TOKEN || '').trim();

function setCommonHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

function send(res, status, body) {
  setCommonHeaders(res);
  return res.status(status).json(body);
}

function normalize(c) {
  if (!c || typeof c !== 'object') return null;

  if (!c.code) c.code = 'CTS-' + Math.random().toString(36).slice(2, 10).toUpperCase();
  if (!c.empresa) c.empresa = 'Sin empresa';
  if (!c.operador) c.operador = 'Sin operador';
  if (!c.carga) c.carga = 'Sin carga';
  if (!c.fecha) c.fecha = '';
  if (!c.hora) c.hora = '';
  if (!c.tel) c.tel = '';
  if (!c.notas) c.notas = '';

  if (!c.status) c.status = 'Confirmada';

  if (c.status === 'Pendiente') c.status = 'En proceso';
  if (c.status === 'Cancelada') c.status = 'Confirmada';

  if (!['Confirmada', 'En proceso', 'Completada'].includes(c.status)) {
    c.status = 'Confirmada';
  }

  if (c.scanCount === undefined || c.scanCount === null || isNaN(Number(c.scanCount))) {
    c.scanCount = c.status === 'Completada' ? 2 : c.status === 'En proceso' ? 1 : 0;
  }

  c.scanCount = Number(c.scanCount);

  return c;
}

function githubRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;

    const headers = {
      'User-Agent': 'cooper-logistics-demo',
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };

    if (TOKEN) {
      headers['Authorization'] = `token ${TOKEN}`;
    }

    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const options = {
      hostname: 'api.github.com',
      path: apiPath,
      method,
      headers
    };

    const req = https.request(options, (response) => {
      let raw = '';

      response.on('data', chunk => {
        raw += chunk;
      });

      response.on('end', () => {
        let json = null;

        try {
          json = JSON.parse(raw || '{}');
        } catch {
          json = { raw };
        }

        resolve({
          status: response.statusCode,
          json,
          raw
        });
      });
    });

    req.on('error', reject);

    if (payload) {
      req.write(payload);
    }

    req.end();
  });
}

function encodedFilePath() {
  return FILE_PATH.split('/').map(encodeURIComponent).join('/');
}

async function readFile() {
  const path = `/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(REPO)}/contents/${encodedFilePath()}?ref=${encodeURIComponent(BRANCH)}`;
  const result = await githubRequest('GET', path);

  if (result.status === 404) {
    return {
      citas: [],
      sha: null
    };
  }

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`GitHub READ ${result.status}: ${result.json.message || result.raw || 'Sin detalle'}`);
  }

  const content = Buffer.from(result.json.content || '', 'base64').toString('utf8');

  let citas = [];

  try {
    const parsed = JSON.parse(content || '[]');
    citas = Array.isArray(parsed) ? parsed : parsed.citas || [];
  } catch {
    citas = [];
  }

  citas = citas.map(normalize).filter(Boolean);

  return {
    citas,
    sha: result.json.sha
  };
}

async function writeFile(citas, sha, message) {
  if (!TOKEN) {
    throw new Error('Falta GITHUB_TOKEN en Vercel.');
  }

  const path = `/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(REPO)}/contents/${encodedFilePath()}`;

  const payload = {
    message,
    content: Buffer.from(JSON.stringify(citas, null, 2), 'utf8').toString('base64'),
    branch: BRANCH
  };

  if (sha) {
    payload.sha = sha;
  }

  const result = await githubRequest('PUT', path, payload);

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`GitHub WRITE ${result.status}: ${result.json.message || result.raw || 'Sin detalle'}`);
  }

  return result.json;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') {
      return resolve(req.body);
    }

    let raw = '';

    req.on('data', chunk => {
      raw += chunk;
    });

    req.on('end', () => {
      if (!raw) return resolve({});

      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });

    req.on('error', reject);
  });
}

function advanceStatus(c) {
  c = normalize(c);

  if (c.status === 'Confirmada') {
    c.status = 'En proceso';
    c.scanCount = 1;
    c.lastScan = new Date().toISOString();
    return 'Primer escaneo registrado. La cita cambió a EN PROCESO.';
  }

  if (c.status === 'En proceso') {
    c.status = 'Completada';
    c.scanCount = 2;
    c.lastScan = new Date().toISOString();
    return 'Segundo escaneo registrado. La cita cambió a COMPLETADA.';
  }

  c.status = 'Completada';
  c.scanCount = Math.max(c.scanCount || 2, 2);
  c.lastScan = new Date().toISOString();

  return 'Esta cita ya estaba COMPLETADA.';
}

module.exports = async function handler(req, res) {
  setCommonHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    if (req.method === 'GET') {
      const { citas } = await readFile();

      return send(res, 200, {
        ok: true,
        citas,
        debug: req.query && req.query.debug ? {
          owner: OWNER,
          repo: REPO,
          branch: BRANCH,
          filePath: FILE_PATH,
          tokenPresent: Boolean(TOKEN),
          tokenLength: TOKEN ? TOKEN.length : 0
        } : undefined
      });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const { citas, sha } = await readFile();

      if (body.action === 'create') {
        const cita = normalize(body.cita || {});
        const exists = citas.find(x => x.code === cita.code);

        if (!exists) {
          citas.unshift(cita);
        }

        await writeFile(citas, sha, `Crear cita ${cita.code}`);

        return send(res, 200, {
          ok: true,
          cita,
          citas
        });
      }

      if (body.action === 'delete') {
        const code = body.code;
        const updated = citas.filter(c => c.code !== code);

        await writeFile(updated, sha, `Eliminar cita ${code}`);

        return send(res, 200, {
          ok: true,
          citas: updated
        });
      }

      return send(res, 400, {
        ok: false,
        error: 'Accion POST no valida.'
      });
    }

    if (req.method === 'PATCH') {
      const body = await readBody(req);
      const { citas, sha } = await readFile();

      if (body.action === 'scan') {
        const code = body.code;
        const incoming = body.data || {};

        let cita = citas.find(c => c.code === code);

        if (!cita) {
          cita = normalize({
            code,
            empresa: incoming.empresa || 'Sin empresa',
            operador: incoming.operador || 'Sin operador',
            tel: incoming.tel || '',
            carga: incoming.carga || 'Sin carga',
            fecha: incoming.fecha || '',
            hora: incoming.hora || '',
            notas: incoming.notas || '',
            status: 'Confirmada',
            scanCount: 0,
            createdAt: new Date().toISOString()
          });

          citas.unshift(cita);
        }

        const message = advanceStatus(cita);

        await writeFile(citas, sha, `Escaneo QR ${code}`);

        return send(res, 200, {
          ok: true,
          message,
          cita,
          citas
        });
      }

      return send(res, 400, {
        ok: false,
        error: 'Accion PATCH no valida.'
      });
    }

    return send(res, 405, {
      ok: false,
      error: 'Metodo no permitido.'
    });

  } catch (error) {
    return send(res, 500, {
      ok: false,
      error: error.message || 'Error interno.',
      debug: {
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        filePath: FILE_PATH,
        tokenPresent: Boolean(TOKEN),
        tokenLength: TOKEN ? TOKEN.length : 0
      }
    });
  }
};