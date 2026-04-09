exports.handler = async function(event, context) {
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!serviceAccountKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'GOOGLE_SERVICE_ACCOUNT_KEY environment variable is not set.' })
    };
  }

  try {
    const credentials = JSON.parse(serviceAccountKey);
    const token = await getAccessToken(credentials);

    const sheetId = '1VFQFIQ80kGnx7F7p0YfsXQ_WPXmxWx_MVowohiF09fk';
    const range = encodeURIComponent('Client Health Tracker!A5:K200');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: data.error?.message || 'Google Sheets API error' })
      };
    }

    const rows = data.values || [];
    if (rows.length < 2) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify([])
      };
    }

    const companies = rows.slice(1)
      .filter(row => row[0] && row[0].trim())
      .map(row => ({
        client:              (row[0]  || '').trim(),
        account_manager:     (row[1]  || '').trim(),
        content_engineer:    (row[2]  || '').trim(),
        content_performance: (row[3]  || '').trim(),
        content_notes:       (row[4]  || '').trim(),
        action_items:        (row[5]  || '').trim(),
        weeks_ahead:         (row[6]  || '').trim(),
        posts_ahead:         (row[7]  || '').trim(),
        warm_outbound:       (row[8]  || '').trim(),
        heyreach_running:    (row[9]  || '').trim(),
        cs_sentiment:        (row[10] || '').trim()
      }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(companies)
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};

async function getAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64(header)}.${b64(payload)}`;

  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(unsigned);
  const signature = sign.sign(credentials.private_key, 'base64url');
  const jwt = `${unsigned}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error('Failed to get access token: ' + JSON.stringify(tokenData));
  }
  return tokenData.access_token;
}
