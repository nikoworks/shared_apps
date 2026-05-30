const CHATWORK_BASE_URL = 'https://api.chatwork.com/v2';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GETだけ使えます' });
  }

  const token = process.env.CHATWORK_API_TOKEN;
  const requiredKey = process.env.TASKBOARD_IMPORT_KEY || '';
  const providedKey = req.headers['x-taskboard-key'] || '';
  const roomId = String(req.query.roomId || process.env.CHATWORK_ROOM_ID || '').trim();
  const force = req.query.force === '1' ? '1' : '0';

  if (!token) {
    return res.status(500).json({ error: 'VercelにCHATWORK_API_TOKENが設定されていません' });
  }
  if (requiredKey && providedKey !== requiredKey) {
    return res.status(401).json({ error: '取り込みキーが違います' });
  }
  if (!/^\d+$/.test(roomId)) {
    return res.status(400).json({ error: 'ChatworkのルームIDを指定してください' });
  }

  const url = `${CHATWORK_BASE_URL}/rooms/${roomId}/messages?force=${force}`;
  const cwRes = await fetch(url, {
    headers: {
      accept: 'application/json',
      'x-chatworktoken': token,
    },
  });

  if (cwRes.status === 204) {
    return res.status(200).json({ roomId, messages: [], importedCount: 0 });
  }

  const text = await cwRes.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!cwRes.ok) {
    return res.status(cwRes.status).json({
      error: 'Chatworkからメッセージを取得できませんでした',
      detail: payload,
    });
  }

  const messages = Array.isArray(payload)
    ? payload
        .map(message => ({
          message_id: message.message_id,
          body: message.body || '',
          send_time: message.send_time || 0,
          account: {
            account_id: message.account?.account_id,
            name: message.account?.name || '',
          },
        }))
        .sort((a, b) => a.send_time - b.send_time)
    : [];

  const imported = messages.filter(message => /(^|\n)\s*#(?:task|ask)\b/i.test(message.body || ''));

  return res.status(200).json({
    roomId,
    messages: imported,
    importedCount: imported.length,
  });
};
