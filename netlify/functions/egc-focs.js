// Face of Content labels, per company, for the EGC Usage tab's cross-check.
//
// The tab's rows come from the product database — a seat is the only thing that
// generates usage data, so it has to be the row set. But HubSpot's "Face of
// Content" association label is where the team records who is SUPPOSED to be
// publishing, and the two can drift apart without anyone noticing. Runpod is the
// case that proved it: its EGC engagement kicked off on 25 August with two seats,
// and neither carried the label, so the account read fine on this tab while its
// NPS survey was routed to the Full Service publisher instead.
//
// This returns the labelled contacts so the tab can flag that gap. It reuses the
// exact resolution the monthly NPS send uses — same label match, same batching —
// so the two can never disagree about who carries the label.
const { fetchActiveCompanies, fetchFocContactIds, fetchContacts } = require('./_nps-core');

exports.handler = async function () {
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'HUBSPOT_TOKEN is not set.' }) };
  }

  try {
    const companies = await fetchActiveCompanies(token);
    const byCompany = await fetchFocContactIds(token, companies.map(c => c.id));
    const ids = [...new Set(Object.values(byCompany).flat())];
    const contacts = await fetchContacts(token, ids);

    // Keyed by company NAME, lower-cased: that is how the EGC tab already joins
    // the product database to HubSpot, and company ids do not cross that seam.
    const out = {};
    for (const c of companies) {
      const people = (byCompany[c.id] || [])
        .map(id => contacts[id])
        .filter(Boolean)
        .map(p => ({ name: p.name, email: p.email ? p.email.toLowerCase() : null }));
      if (people.length) out[String(c.name || '').trim().toLowerCase()] = people;
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({ focs: out }) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
