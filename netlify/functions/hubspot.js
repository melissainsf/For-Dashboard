// Virio CS Dashboard - HubSpot serverless function v2
exports.handler = async function(event, context) {
  const token = process.env.HUBSPOT_TOKEN;

  if (!token) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'HUBSPOT_TOKEN environment variable is not set.' })
    };
  }

  const requestBody = {
    filterGroups: [{
      filters: [{
        propertyName: 'pilot_status',
        operator: 'IN',
        values: ['In progress', 'Converted', 'Exited During Pilot', 'Churned Post Conversion']
      }]
    }],
    properties: [
      'name', 'pilot_status', 'stage', 'mrr', 'expansion_mrr',
      'churned_mrr_value', 'churn_reason', 'domain', 'csm',
      'kickoff_call_date', 'first_post_date', 'vertical', 'customer_journey',
      'content_manager', 'posts_per_month', 'product'
    ],
    limit: 200
  };

  try {
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(requestBody)
    });

    const data = await res.json();

    return {
      statusCode: res.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(data)
    };
  } catch(e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message })
    };
  }
};
