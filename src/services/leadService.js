const pool = require("../config/database");

/*
 * =========================================================
 * HEALTH
 * =========================================================
 */

async function checkHealth() {
  await pool.query("SELECT 1");
}

/*
 * =========================================================
 * GET ALL LEADS
 * =========================================================
 */

async function getAllLeads(search = "") {
  const q = search.trim();
  const searchValue = `%${q}%`;

  const result = await pool.query(
    `
    SELECT
      l.id,
      l.name,
      l.company,
      l.email,
      l.phone,
      l.channel,
      l.status,
      l.score,
      l.created_at,
      l.updated_at,

      COALESCE(
        JSON_AGG(
          DISTINCT JSONB_BUILD_OBJECT(
            'id', s.id,
            'name', s.name,
            'description', s.description,
            'category', s.category,
            'status', s.status
          )
        ) FILTER (WHERE s.id IS NOT NULL),
        '[]'::json
      ) AS services

    FROM leads l

    LEFT JOIN lead_services ls
      ON ls.lead_id = l.id

    LEFT JOIN services s
      ON s.id = ls.service_id

    WHERE
      $1 = ''
      OR l.name ILIKE $2
      OR l.company ILIKE $2
      OR l.email ILIKE $2
      OR l.phone ILIKE $2

    GROUP BY l.id

    ORDER BY l.id DESC
    `,
    [q, searchValue],
  );

  return result.rows;
}

/*
 * =========================================================
 * GET LEAD BY ID
 * =========================================================
 */

async function getLeadById(leadId) {
  const result = await pool.query(
    `
    SELECT
      id,
      name,
      company,
      email,
      phone,
      channel,
      status,
      score,
      created_at,
      updated_at
    FROM leads
    WHERE id = $1
    `,
    [leadId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const services = await getLeadServices(leadId);

  return {
    ...result.rows[0],
    services,
  };
}

/*
 * =========================================================
 * CREATE LEAD
 * =========================================================
 */

async function createLead(data) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
      INSERT INTO leads
      (
        name,
        company,
        email,
        phone,
        channel,
        status,
        score
      )
      VALUES
      ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [
        data.name.trim(),
        data.company?.trim() || null,
        data.email?.trim() || null,
        data.phone?.trim() || null,
        data.channel || "Website",
        data.status || "New",
        Number(data.score ?? 0),
      ],
    );

    const lead = result.rows[0];

    /*
     * Create lead ↔ service mappings.
     */

    for (const serviceId of data.serviceIds) {
      await client.query(
        `
        INSERT INTO lead_services
        (
          lead_id,
          service_id
        )
        VALUES
        ($1, $2)
        `,
        [lead.id, serviceId],
      );
    }

    await client.query("COMMIT");

    return {
      ...lead,
      serviceIds: data.serviceIds,
    };
  } catch (error) {
    await client.query("ROLLBACK");

    throw error;
  } finally {
    client.release();
  }
}

/*
 * =========================================================
 * UPDATE LEAD
 * =========================================================
 */

async function updateLead(leadId, data) {
  const result = await pool.query(
    `
    UPDATE leads

    SET
      name = COALESCE($1, name),
      company = COALESCE($2, company),
      email = COALESCE($3, email),
      phone = COALESCE($4, phone),
      channel = COALESCE($5, channel),
      status = COALESCE($6, status),
      score = COALESCE($7, score),
      updated_at = NOW()

    WHERE id = $8

    RETURNING *
    `,
    [
      data.name?.trim() || null,
      data.company?.trim() || null,
      data.email?.trim() || null,
      data.phone?.trim() || null,
      data.channel || null,
      data.status || null,
      data.score !== undefined ? Number(data.score) : null,
      leadId,
    ],
  );

  return result.rows[0] || null;
}

/*
 * =========================================================
 * GET LEAD SERVICES
 * =========================================================
 */

async function getLeadServices(leadId) {
  const result = await pool.query(
    `
    SELECT
      s.id,
      s.name,
      s.description,
      s.category,
      s.status

    FROM services s

    INNER JOIN lead_services ls
      ON ls.service_id = s.id

    WHERE ls.lead_id = $1

    ORDER BY s.name
    `,
    [leadId],
  );

  return result.rows;
}

/*
 * =========================================================
 * CHECK LEAD EXISTS
 * =========================================================
 */

async function leadExists(leadId) {
  const result = await pool.query(
    `
    SELECT id
    FROM leads
    WHERE id = $1
    `,
    [leadId],
  );

  return result.rows.length > 0;
}

/*
 * =========================================================
 * REPLACE LEAD SERVICES
 * =========================================================
 */

async function updateLeadServices(leadId, serviceIds) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /*
     * Verify lead.
     */

    const lead = await client.query(
      `
      SELECT id
      FROM leads
      WHERE id = $1
      `,
      [leadId],
    );

    if (lead.rows.length === 0) {
      const error = new Error("Lead not found");

      error.statusCode = 404;

      throw error;
    }

    /*
     * Validate service IDs.
     */

    if (serviceIds.length > 0) {
      const services = await client.query(
        `
        SELECT id
        FROM services
        WHERE id = ANY($1::int[])
        `,
        [serviceIds],
      );

      if (services.rows.length !== serviceIds.length) {
        const error = new Error("One or more service IDs are invalid");

        error.statusCode = 400;

        throw error;
      }
    }

    /*
     * Remove existing mappings.
     */

    await client.query(
      `
      DELETE FROM lead_services
      WHERE lead_id = $1
      `,
      [leadId],
    );

    /*
     * Add new mappings.
     */

    for (const serviceId of serviceIds) {
      await client.query(
        `
        INSERT INTO lead_services
        (
          lead_id,
          service_id
        )
        VALUES
        ($1, $2)
        `,
        [leadId, serviceId],
      );
    }

    await client.query("COMMIT");

    return {
      leadId: Number(leadId),
      serviceIds,
    };
  } catch (error) {
    await client.query("ROLLBACK");

    throw error;
  } finally {
    client.release();
  }
}

/*
 * =========================================================
 * CONVERT LEAD → CUSTOMER
 * =========================================================
 *
 * IMPORTANT:
 *
 * This remains one transaction.
 *
 * 1. Lock lead
 * 2. Validate lead
 * 3. Get services
 * 4. Find customer
 * 5. Create customer if needed
 * 6. Copy services
 * 7. Mark lead Converted
 * 8. Commit
 *
 * Any failure rolls everything back.
 * =========================================================
 */

async function convertLead(leadId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    console.log(`[DB] Conversion transaction started leadId=${leadId}`);

    /*
     * =======================================================
     * LOCK LEAD
     * =======================================================
     *
     * FOR UPDATE prevents two requests from converting
     * the same lead simultaneously.
     */

    const leadResult = await client.query(
      `
      SELECT
        id,
        name,
        company,
        email,
        phone,
        channel,
        status,
        score
      FROM leads
      WHERE id = $1
      FOR UPDATE
      `,
      [leadId],
    );

    if (leadResult.rows.length === 0) {
      const error = new Error("Lead not found");

      error.statusCode = 404;

      throw error;
    }

    const lead = leadResult.rows[0];

    /*
     * =======================================================
     * PREVENT DOUBLE CONVERSION
     * =======================================================
     */

    if (lead.status === "Converted") {
      const error = new Error("Lead has already been converted");

      error.statusCode = 400;

      throw error;
    }

    /*
     * =======================================================
     * GET SERVICES
     * =======================================================
     */

    const servicesResult = await client.query(
      `
      SELECT
        s.id,
        s.name,
        s.description,
        s.category,
        s.status

      FROM services s

      INNER JOIN lead_services ls
        ON ls.service_id = s.id

      WHERE ls.lead_id = $1

      ORDER BY s.name
      `,
      [leadId],
    );

    const leadServices = servicesResult.rows;

    /*
     * =======================================================
     * FIND EXISTING CUSTOMER
     * =======================================================
     */

    let customer = null;

    if (lead.email) {
      const existingCustomerResult = await client.query(
        `
          SELECT
            id,
            name,
            company,
            email,
            phone,
            segment,
            created_at,
            updated_at
          FROM customers
          WHERE LOWER(email) = LOWER($1)
          LIMIT 1
          `,
        [lead.email],
      );

      if (existingCustomerResult.rows.length > 0) {
        customer = existingCustomerResult.rows[0];

        console.log(`[CONVERT] Existing customer found id=${customer.id}`);
      }
    }

    /*
     * =======================================================
     * CREATE CUSTOMER
     * =======================================================
     */

    if (!customer) {
      const customerResult = await client.query(
        `
        INSERT INTO customers
        (
          name,
          company,
          email,
          phone,
          segment
        )
        VALUES
        ($1, $2, $3, $4, $5)
        RETURNING *
        `,
        [
          lead.name,
          lead.company || null,
          lead.email || null,
          lead.phone || null,
          "Standard",
        ],
      );

      customer = customerResult.rows[0];

      console.log(`[CONVERT] Created customer id=${customer.id}`);
    }

    /*
     * =======================================================
     * COPY SERVICES
     * =======================================================
     */

    for (const service of leadServices) {
      await client.query(
        `
        INSERT INTO customer_services
        (
          customer_id,
          service_id
        )
        VALUES
        ($1, $2)
        ON CONFLICT
        (
          customer_id,
          service_id
        )
        DO NOTHING
        `,
        [customer.id, service.id],
      );
    }

    /*
     * =======================================================
     * MARK LEAD CONVERTED
     * =======================================================
     */

    const convertedLeadResult = await client.query(
      `
      UPDATE leads

      SET
        status = 'Converted',
        updated_at = NOW()

      WHERE id = $1

      RETURNING *
      `,
      [leadId],
    );

    /*
     * =======================================================
     * COMMIT
     * =======================================================
     */

    await client.query("COMMIT");

    return {
      message: "Lead converted successfully",

      lead: convertedLeadResult.rows[0],

      customer: {
        ...customer,
        services: leadServices,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");

    throw error;
  } finally {
    client.release();
  }
}

/*
 * =========================================================
 * DELETE LEAD
 * =========================================================
 */

async function deleteLead(leadId) {
  const result = await pool.query(
    `
    DELETE FROM leads
    WHERE id = $1
    RETURNING id
    `,
    [leadId],
  );

  return result.rows[0] || null;
}

module.exports = {
  checkHealth,
  getAllLeads,
  getLeadById,
  createLead,
  updateLead,
  getLeadServices,
  leadExists,
  updateLeadServices,
  convertLead,
  deleteLead,
};
