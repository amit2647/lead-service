const { profiles } = require("bundle-sdk");

const pool = require("../config/database");

/*
 * A lead as a prospect on the bundle's pipeline board (PROS-01–05): its
 * column (status), quoted fee, next meeting, notes and bundle fields.
 *
 * Only for organizations with a profession bundle; "Converted" is never set
 * here — converting is POST /leads/:id/convert, which creates the client.
 */

function badRequest(message, details) {
  const error = new Error(message);
  error.statusCode = 400;
  if (details) error.details = details;
  return error;
}

function validate(bundle, input) {
  const errors = {};
  const changes = {};

  if (input.status !== undefined) {
    const status = String(input.status || "").trim();
    const columns = (bundle.pipeline || []).map((column) => column.status);

    if (status === "Converted") {
      errors.status = "Convert a lead to make it a client";
    } else if (columns.length > 0 && !columns.includes(status)) {
      errors.status = `status must be one of: ${columns.join(", ")}`;
    } else if (!status || status.length > 50) {
      errors.status = "status is required";
    } else {
      changes.status = status;
    }
  }

  if (input.quotedFee !== undefined) {
    const fee = input.quotedFee === null || input.quotedFee === "" ? null : Number(input.quotedFee);

    if (fee !== null && (!Number.isFinite(fee) || fee < 0 || fee >= 1e12)) {
      errors.quotedFee = "Quoted fee must be a positive amount";
    } else {
      changes.quoted_fee = fee;
    }
  }

  if (input.nextMeetingOn !== undefined) {
    const date = input.nextMeetingOn || null;

    if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.nextMeetingOn = "Next meeting must be a date (YYYY-MM-DD)";
    } else {
      changes.next_meeting_on = date;
    }
  }

  if (input.notes !== undefined) {
    changes.notes = input.notes ? String(input.notes).trim().slice(0, 5000) : null;
  }

  if (input.attributes !== undefined) {
    const schema = bundle.profiles?.lead?.schema;

    if (!schema) {
      errors.attributes = "This bundle has no prospect fields";
    } else {
      const result = profiles.validate(schema, input.attributes || {});
      Object.assign(errors, result.errors);
      changes.attributes = result.value;
      changes.attributes_version = bundle.profiles.lead.version;
    }
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Some prospect details need attention", errors);
  }

  return changes;
}

async function updateProspect({ organizationId, userId, role }, bundle, leadId, input) {
  const changes = validate(bundle, input);
  const columns = Object.keys(changes);

  if (columns.length === 0) {
    throw badRequest("Nothing to change");
  }

  const values = columns.map((column) => changes[column]);
  const assignments = columns.map((column, index) => `${column} = $${index + 1}`);

  values.push(leadId, organizationId);

  let query = `
    UPDATE leads SET ${assignments.join(", ")}, updated_at = NOW()
    WHERE id = $${values.length - 1} AND organization_id = $${values.length}
      AND status <> 'Converted'
  `;

  // Sales representatives move only their own leads, as everywhere else.
  if (role === "SALES_REP") {
    values.push(userId);
    query += ` AND owner_user_id = $${values.length}`;
  }

  const result = await pool.query(`${query} RETURNING *`, values);

  if (!result.rows[0]) {
    // A converted prospect is the client's history now: it stays as it was.
    const converted = await pool.query(
      `SELECT 1 FROM leads WHERE id = $1 AND organization_id = $2 AND status = 'Converted'`,
      [leadId, organizationId],
    );
    const error = new Error(converted.rows[0] ? "This prospect is already a client and can no longer be changed" : "Lead not found");
    error.statusCode = converted.rows[0] ? 409 : 404;
    throw error;
  }

  return result.rows[0];
}

module.exports = { updateProspect, validate };
