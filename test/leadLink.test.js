const { test, before, after, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

/*
 * Linking a lead to the customer it became (migration 017) and what
 * conversion tells customer-service. The database and customer-service are
 * stand-ins.
 */

process.env.JWT_SECRET = "unit-test-secret";
process.env.JWT_ISSUER = "unit-test-issuer";
process.env.CUSTOMER_SERVICE_URL = "http://customer-service.test";

let leads;
let calls;
let customerAnswer;

const realFetch = global.fetch;

global.fetch = async (url, options) => {
  if (String(url).startsWith("http://customer-service.test")) {
    calls.push({ url: String(url), method: options.method, body: JSON.parse(options.body || "{}") });
    return new Response(JSON.stringify(customerAnswer.body), { status: customerAnswer.status });
  }

  return realFetch(url, options);
};

const pool = require("../src/config/database");

function query(text, params = []) {
  const sql = text.replace(/\s+/g, " ").trim();

  if (/access_grants/.test(sql) || /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
  if (/^SELECT service_id FROM lead_services/.test(sql)) return { rows: [] };

  if (/^SELECT .* FROM leads WHERE id = \$1 AND organization_id = \$2/.test(sql)) {
    return { rows: leads.filter((lead) => lead.id === Number(params[0]) && lead.organization_id === params[1]) };
  }

  if (/^UPDATE leads SET status = 'Converted', converted_customer_id = \$3/.test(sql) || /^UPDATE leads SET status = 'Converted', converted_customer_id = \$\d/.test(sql)) {
    const lead = leads.find((item) => item.id === Number(params[0]));
    lead.status = "Converted";
    lead.converted_customer_id = params[params.length - 1];
    return { rows: [lead] };
  }

  throw new Error(`Unexpected SQL: ${sql}`);
}

pool.query = async (text, params) => query(text, params);
pool.connect = async () => ({ query: async (text, params) => query(text, params), release() {} });

const app = require("../src/app");
let server;
let base;

before(async () => {
  mock.method(console, "log", () => {});
  mock.method(console, "error", () => {});
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  global.fetch = realFetch;
});

beforeEach(() => {
  calls = [];
  customerAnswer = { status: 200, body: { id: 20, name: "Rao & Co", source_lead_id: 4 } };
  leads = [{ id: 4, organization_id: 3, owner_user_id: 7, name: "Rao & Co", email: null, phone: null, company: null, notes: "Met at the GST seminar", status: "New", converted_customer_id: null }];
});

const token = (permissions) => jwt.sign({ sub: 7, organizationId: 3, role: "X", permissions }, process.env.JWT_SECRET, { issuer: process.env.JWT_ISSUER });

const post = (path, body, permissions = ["leads.update", "customers.update"]) =>
  realFetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token(permissions)}` },
    body: JSON.stringify(body),
  });

test("converting tells customer-service which lead it is, with its notes", async () => {
  customerAnswer = { status: 201, body: { customer: { id: 20 } } };

  const response = await post("/leads/4/convert", {});

  assert.equal(response.status, 200);
  assert.equal(calls[0].body.leadId, 4);
  assert.equal(calls[0].body.notes, "Met at the GST seminar");
  assert.equal(leads[0].converted_customer_id, 20);
});

test("linking needs both leads.update and customers.update", async () => {
  assert.equal((await post("/leads/4/link", { customerId: 20 }, ["leads.update"])).status, 403);
  assert.equal((await post("/leads/4/link", { customerId: 20 }, ["customers.update"])).status, 403);
  assert.equal((await post("/leads/4/link", { customerId: "20" })).status, 400);
});

test("linking records the customer's side first, then marks the lead converted", async () => {
  const response = await post("/leads/4/link", { customerId: 20 });

  assert.equal(response.status, 200);
  assert.deepEqual(calls.map((call) => [call.url, call.method, call.body]), [["http://customer-service.test/customers/20/source-lead", "PUT", { leadId: 4 }]]);
  assert.deepEqual([leads[0].status, leads[0].converted_customer_id], ["Converted", 20]);

  // Again: the same answer.
  assert.equal((await post("/leads/4/link", { customerId: 20 })).status, 200);
});

test("a lead linked to another customer is refused before anything is written", async () => {
  leads[0].converted_customer_id = 21;

  assert.equal((await post("/leads/4/link", { customerId: 20 })).status, 409);
  assert.equal(calls.length, 0);
});

test("customer-service's refusal stops the link", async () => {
  customerAnswer = { status: 409, body: { error: "That lead already became Other Ltd" } };

  const response = await post("/leads/4/link", { customerId: 20 });

  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Other Ltd/);
  assert.equal(leads[0].status, "New");
});
