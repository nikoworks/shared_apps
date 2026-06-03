const CHATWORK_BASE_URL = 'https://api.chatwork.com/v2';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POSTだけ使えます' });
  }

  const expectedKey = process.env.TASKBOARD_IMPORT_KEY || '';
  const providedKey = req.headers['x-taskboard-key'] || '';
  if (expectedKey && providedKey !== expectedKey) {
    return res.status(401).json({ error: '取り込みキーが違います' });
  }

  const token = process.env.CHATWORK_API_TOKEN;
  const roomId = String(req.body?.roomId || process.env.CHATWORK_ROOM_ID || '').trim();
  const body = String(req.body?.body || '').trim();

  if (!token) {
    return res.status(500).json({ error: 'VercelにCHATWORK_API_TOKENが設定されていません' });
  }
  if (!/^\d+$/.test(roomId)) {
    return res.status(400).json({ error: 'ChatworkのルームIDを指定してください' });
  }
  if (!body) {
    return res.status(400).json({ error: '返信メッセージが空です' });
  }

  const cwRes = await fetch(`${CHATWORK_BASE_URL}/rooms/${roomId}/messages`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      'x-chatworktoken': token,
    },
    body: new URLSearchParams({ body }).toString(),
  });

  const text = await cwRes.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!cwRes.ok) {
    return res.status(cwRes.status).json({
      error: 'Chatworkへ返信できませんでした',
      detail: payload,
    });
  }

  return res.status(200).json(payload || { ok: true });
};
