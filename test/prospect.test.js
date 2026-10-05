const { test, before, after, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

/*
 * The prospect board's rules (PROS-01–05): a lead moves only between the
 * bundle's pipeline columns, never to Converted by hand, and only for an
 * organization with a bundle installed.
 */

process.env.JWT_SECRET = "unit-test-secret";
process.env.JWT_ISSUER = "unit-test-issuer";
process.env.BUNDLE_SERVICE_URL = "http://bundle-service.test";

const BUNDLE = {
  key: "ca-practice",
  pipeline: [
    { key: "lead", label: "Leads", status: "New" },
    { key: "discussion", label: "In Discussion", status: "In Discussion" },
    { key: "quoted", label: "Quote Sent", status: "Quote Sent" },
  ],
  profiles: { lead: { version: 1, schema: { type: "object", properties: { constitution: { type: "string", enum: ["llp", "huf"] } } } } },
};

let installed;
let statements;

const realFetch = global.fetch;

global.fetch = async (url, options) =>
  String(url).startsWith("http://bundle-service.test")
    ? new Response(JSON.stringify({ bundle: installed }), { status: 200 })
    : realFetch(url, options);

const pool = require("../src/config/database");

pool.query = async (text, params) => {
  const sql = text.replace(/\s+/g, " ").trim();
  statements.push({ sql, params });
  if (/access_grants/.test(sql)) return { rows: [] };
  return { rows: [{ id: 4, status: params[0] }] };
};

const { validate, updateProspect } = require("../src/services/prospectService");
const { forget } = require("../src/services/bundleContext");

beforeEach(() => {
  installed = BUNDLE;
  statements = [];
  forget(3);
});

after(() => {
  global.fetch = realFetch;
});

test("a lead moves only between the bundle's columns", () => {
  assert.deepEqual(validate(BUNDLE, { status: "Quote Sent" }), { status: "Quote Sent" });
  assert.throws(() => validate(BUNDLE, { status: "Won" }), (error) => /must be one of: New, In Discussion, Quote Sent/.test(error.details.status));
});

test("Converted is never set by hand — converting creates the client", () => {
  assert.throws(() => validate(BUNDLE, { status: "Converted" }), (error) => /Convert a lead/.test(error.details.status));
});

test("quote, meeting date and bundle fields are checked", () => {
  assert.deepEqual(validate(BUNDLE, { quotedFee: "25000", nextMeetingOn: "2026-10-10", attributes: { constitution: "llp" } }), {
    quoted_fee: 25000,
    next_meeting_on: "2026-10-10",
    attributes: { constitution: "llp" },
    attributes_version: 1,
  });

  assert.throws(() => validate(BUNDLE, { quotedFee: -1 }), (error) => Boolean(error.details.quotedFee));
  assert.throws(() => validate(BUNDLE, { nextMeetingOn: "10/10/2026" }), (error) => Boolean(error.details.nextMeetingOn));
  assert.throws(() => validate(BUNDLE, { attributes: { constitution: "company" } }), (error) => Boolean(error.details.constitution));
});

test("a sales representative moves only their own leads, and never a converted one", async () => {
  await updateProspect({ organizationId: 3, userId: 7, role: "SALES_REP" }, BUNDLE, 4, { status: "New" });

  const update = statements.find((s) => /^UPDATE leads/.test(s.sql));

  assert.match(update.sql, /status <> 'Converted' AND owner_user_id = \$4/);
  assert.deepEqual(update.params, ["New", 4, 3, 7]);
});

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

after(() => server.close());

const patch = (permissions, body) =>
  realFetch(`${base}/leads/4/prospect`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt.sign({ sub: 7, organizationId: 3, role: "X", permissions }, process.env.JWT_SECRET, { issuer: process.env.JWT_ISSUER })}`,
    },
    body: JSON.stringify(body),
  });

test("the board route needs leads.update and a bundle", async () => {
  assert.equal((await patch(["leads.read"], { status: "New" })).status, 403);

  installed = null;
  assert.equal((await patch(["leads.update"], { status: "New" })).status, 404);

  installed = BUNDLE;
  forget(3);
  assert.equal((await patch(["leads.update"], { status: "In Discussion" })).status, 200);
});
