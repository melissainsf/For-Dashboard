export default async (request) => {
  const token = Deno.env.get('HUBSPOT_TOKEN');

  if (!token) {
    return new Response(JSON.stringify({ error: 'HUBSPOT_TOKEN environment variable is not set.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const body = {
    filterGroups: [{
      filters: [{
        propertyName: 'pilot_status',
        operator: 'IN',
        values: ['In progress', 'Converted', 'Exited During Pilot', 'Churned Post Conversion']
      }]
    }],
    properties: ['name', 'pilot_status', 'stage', 'mrr', 'expansion_mrr', 'churned_mrr_value', 'domain'],
    limit: 200
  };

  const res = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
};

export const config = { path: '/api/companies' };
