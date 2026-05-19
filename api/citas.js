const OWNER = process.env.GITHUB_OWNER || 'a01413131-coder';
const REPO = process.env.GITHUB_REPO || 'Cooper-logistics';
const BRANCH = process.env.GITHUB_BRANCH || 'data';
const FILE_PATH = process.env.GITHUB_DATA_PATH || 'data/citas.json';
const TOKEN = process.env.GITHUB_TOKEN;

function headers() {
  return {
    'Authorization': `Bearer ${TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'cooper-logistics-demo'
  };
}

function normalize(c) {
  if (!c || typeof c !== 'object') return null;

  if (!c.code) c.code = 'CTS-' + Math.random().toString(36).slice(2, 10).toUpperCase();
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

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;

  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
  }

  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function readFile() {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: headers()
  });

  if (response.status === 404) {
    return { citas: [], sha: null };
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub read error: ${response.status} ${text}`);
  }

  const json = await response.json();
  const content = Buffer.from(json.content || '', 'base64').toString('utf8');

  let citas = [];

  try {
    const parsed = JSON.parse(content || '[]');
    citas = Array.isArray(parsed) ? parsed : parsed.citas || [];
  } catch {
    citas = [];
  }

  citas = citas.map(normalize).filter(Boolean);

  return { citas, sha: json.sha };
}

async function writeFile(citas, sha, message) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`;

  const payload = {
    message,
    content: Buffer.from(JSON.stringify(citas, null, 2), 'utf8').toString('base64'),
    branch: BRANCH
  };

  if (sha) payload.sha = sha;

  const response = await fetch(url, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub write error: ${response.status} ${text}`);
  }

  return await response.json();
}

function advanceStatus(c) {
  c = normalize(c);

  if (c.status === 'Confirmada') {
    c.status = 'En proceso';
    c.scanCount = 1;
    c.lastScan = new Date().toISOString();
    return 'Primer escaneo registrado. La cita cambio a EN PROCESO.';
  }

  if (c.status === 'En proceso') {
    c.status = 'Completada';
    c.scanCount = 2;
    c.lastScan = new Date().toISOString();
    return 'Segundo escaneo registrado. La cita cambio a COMPLETADA.';
  }

  c.status = 'Completada';
  c.scanCount = Math.max(c.scanCount || 2, 2);
  c.lastScan = new Date().toISOString();
  return 'Esta cita ya estaba COMPLETADA.';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    if (!TOKEN) {
      return res.status(500).json({
        ok: false,
        error: 'Falta configurar GITHUB_TOKEN en Vercel.'
      });
    }

    if (req.method === 'GET') {
      const { citas } = await readFile();
      return res.status(200).json({ ok: true, citas });
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const { citas, sha } = await readFile();

      if (body.action === 'create') {
        const cita = normalize(body.cita || {});
        const exists = citas.find(x => x.code === cita.code);

        if (!exists) {
          citas.unshift(cita);
        }

        await writeFile(citas, sha, `Crear cita ${cita.code}`);

        return res.status(200).json({
          ok: true,
          cita,
          citas
        });
      }

      if (body.action === 'delete') {
        const code = body.code;
        const updated = citas.filter(c => c.code !== code);

        await writeFile(updated, sha, `Eliminar cita ${code}`);

        return res.status(200).json({
          ok: true,
          citas: updated
        });
      }

      return res.status(400).json({
        ok: false,
        error: 'Accion POST no valida.'
      });
    }

    if (req.method === 'PATCH') {
      const body = await readJsonBody(req);
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

        return res.status(200).json({
          ok: true,
          message,
          cita,
          citas
        });
      }

      return res.status(400).json({
        ok: false,
        error: 'Accion PATCH no valida.'
      });
    }

    return res.status(405).json({
      ok: false,
      error: 'Metodo no permitido.'
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Error interno.'
    });
  }
};