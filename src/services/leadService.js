const pool = require("../config/database");

const CUSTOMER_SERVICE_URL =
  process.env.CUSTOMER_SERVICE_URL || "http://customer-service:4002";

const SERVICE_SERVICE_URL =
  process.env.SERVICE_SERVICE_URL || "http://service-service:4003";

/*
 * =========================================================
 * SERVICE SERVICE CLIENT
 * =========================================================
 *
 * Lead Service does NOT directly query the services table.
 *
 * Service Service is the logical owner of the service catalog.
 *
 * Lead Service owns:
 *
 *     lead_services
 *
 * and stores service IDs as relationships.
 *
 * Service details are retrieved through Service Service.
 * =========================================================
 */

/*
 * =========================================================
 * GET SERVICES FROM SERVICE SERVICE
 * =========================================================
 *
 * Used when READING existing lead/service relationships.
 *
 * Both Active and Inactive services are allowed here.
 *
 * This is important because an existing lead may still
 * reference a service that has subsequently been
 * deactivated.
 * =========================================================
 */

async function getServicesFromServiceService(serviceIds, authorizationToken) {
  if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
    return [];
  }

  /*
   * Normalize and remove duplicate service IDs.
   */

  const uniqueServiceIds = [
    ...new Set(
      serviceIds
        .map((serviceId) => Number(serviceId))
        .filter((serviceId) => Number.isInteger(serviceId)),
    ),
  ];

  const services = [];

  /*
   * Service Service endpoint:
   *
   * GET /services/:id
   *
   * This endpoint returns both Active and Inactive services.
   */

  for (const serviceId of uniqueServiceIds) {
    const response = await fetch(
      `${SERVICE_SERVICE_URL}/services/${serviceId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authorizationToken}`,
        },
      },
    );

    let responseBody = {};

    try {
      responseBody = await response.json();
    } catch (error) {
      responseBody = {};
    }

    /*
     * Service does not exist.
     */

    if (response.status === 404) {
      const error = new Error(`Service ${serviceId} not found`);

      error.statusCode = 400;

      throw error;
    }

    /*
     * Service Service returned another error.
     */

    if (!response.ok) {
      const error = new Error(
        responseBody.error ||
          responseBody.message ||
          "Service Service request failed",
      );

      error.statusCode = response.status;

      throw error;
    }

    const service = responseBody.service || responseBody;

    services.push(service);
  }

  return services;
}

/*
 * =========================================================
 * VALIDATE ACTIVE SERVICES
 * =========================================================
 *
 * Used when CREATING or UPDATING a lead ↔ service
 * relationship.
 *
 * Inactive services cannot be newly assigned.
 *
 * Service Service remains authoritative for this decision.
 * =========================================================
 */

async function validateActiveServices(serviceIds, authorizationToken) {
  if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
    return [];
  }

  /*
   * Normalize and remove duplicate service IDs.
   */

  const uniqueServiceIds = [
    ...new Set(
      serviceIds
        .map((serviceId) => Number(serviceId))
        .filter((serviceId) => Number.isInteger(serviceId)),
    ),
  ];

  /*
   * Resolve each service through Service Service.
   *
   * GET /services/:id returns the service regardless of
   * whether it is Active or Inactive.
   *
   * Therefore we explicitly validate the status here.
   */

  const services = await getServicesFromServiceService(
    uniqueServiceIds,
    authorizationToken,
  );

  for (const service of services) {
    if (service.status !== "Active") {
      const error = new Error(`Service ${service.id} is inactive`);

      error.statusCode = 409;

      throw error;
    }
  }

  return services;
}

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
 *
 * Tenant isolation:
 *
 * Every query is scoped to organizationId.
 *
 * Sales Representatives additionally see only leads
 * assigned to themselves.
 *
 * IMPORTANT:
 *
 * This query intentionally does NOT JOIN the services table.
 *
 * Lead Service only retrieves service IDs from lead_services.
 * Service details are subsequently retrieved from Service
 * Service.
 * =========================================================
 */

async function getAllLeads(
  organizationId,
  userId,
  role,
  search = "",
  authorizationToken,
) {
  const q = search.trim();
  const searchValue = `%${q}%`;

  const values = [organizationId];

  let query = `
    SELECT
      l.id,
      l.organization_id,
      l.owner_user_id,
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
        ARRAY_AGG(DISTINCT ls.service_id)
          FILTER (WHERE ls.service_id IS NOT NULL),
        '{}'
      ) AS service_ids

    FROM leads l

    LEFT JOIN lead_services ls
      ON ls.lead_id = l.id

    WHERE l.organization_id = $1
  `;

  if (role === "SALES_REP") {
    values.push(userId);

    query += `
      AND l.owner_user_id = $${values.length}
    `;
  }

  if (q) {
    values.push(searchValue);

    query += `
      AND (
        l.name ILIKE $${values.length}
        OR l.company ILIKE $${values.length}
        OR l.email ILIKE $${values.length}
        OR l.phone ILIKE $${values.length}
      )
    `;
  }

  query += `
    GROUP BY l.id
    ORDER BY l.id DESC
  `;

  const result = await pool.query(query, values);

  const allServiceIds = [
    ...new Set(
      result.rows.flatMap((lead) =>
        Array.isArray(lead.service_ids) ? lead.service_ids.map(Number) : [],
      ),
    ),
  ];

  /*
   * Existing relationships can resolve inactive services.
   */

  const services = await getServicesFromServiceService(
    allServiceIds,
    authorizationToken,
  );

  const serviceMap = new Map(
    services.map((service) => [Number(service.id), service]),
  );

  return result.rows.map((lead) => {
    const serviceIds = Array.isArray(lead.service_ids)
      ? lead.service_ids.map(Number)
      : [];

    const leadServices = serviceIds
      .map((serviceId) => serviceMap.get(serviceId))
      .filter(Boolean)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

    const { service_ids, ...leadData } = lead;

    return {
      ...leadData,
      services: leadServices,
    };
  });
}

/*
 * =========================================================
 * GET LEAD BY ID
 * =========================================================
 */

async function getLeadById(
  leadId,
  organizationId,
  userId,
  role,
  authorizationToken,
) {
  const values = [leadId, organizationId];

  let query = `
    SELECT
      id,
      organization_id,
      owner_user_id,
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
      AND organization_id = $2
  `;

  if (role === "SALES_REP") {
    values.push(userId);

    query += `
      AND owner_user_id = $${values.length}
    `;
  }

  const result = await pool.query(query, values);

  if (result.rows.length === 0) {
    return null;
  }

  const services = await getLeadServices(
    leadId,
    organizationId,
    userId,
    role,
    authorizationToken,
  );

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

async function createLead(data, authorizationToken) {
  const serviceIds = Array.isArray(data.serviceIds)
    ? [
        ...new Set(
          data.serviceIds
            .map((serviceId) => Number(serviceId))
            .filter((serviceId) => Number.isInteger(serviceId)),
        ),
      ]
    : [];

  /*
   * NEW RELATIONSHIP:
   *
   * Only Active services can be assigned.
   */

  await validateActiveServices(serviceIds, authorizationToken);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
      INSERT INTO leads
      (
        organization_id,
        owner_user_id,
        name,
        company,
        email,
        phone,
        channel,
        status,
        score
      )
      VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
      `,
      [
        data.organizationId,
        data.ownerUserId,
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
        [lead.id, serviceId],
      );
    }

    await client.query("COMMIT");

    return {
      ...lead,
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
 * UPDATE LEAD
 * =========================================================
 */

async function updateLead(leadId, organizationId, userId, role, data) {
  const values = [
    data.name?.trim() || null,
    data.company?.trim() || null,
    data.email?.trim() || null,
    data.phone?.trim() || null,
    data.channel || null,
    data.status || null,
    data.score !== undefined ? Number(data.score) : null,
    leadId,
    organizationId,
  ];

  let query = `
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
      AND organization_id = $9
  `;

  if (role === "SALES_REP") {
    values.push(userId);

    query += `
      AND owner_user_id = $${values.length}
    `;
  }

  query += `
    RETURNING *
  `;

  const result = await pool.query(query, values);

  return result.rows[0] || null;
}

/*
 * =========================================================
 * GET LEAD SERVICES
 * =========================================================
 */

async function getLeadServices(
  leadId,
  organizationId,
  userId,
  role,
  authorizationToken,
) {
  const values = [leadId, organizationId];

  let query = `
    SELECT
      ls.service_id

    FROM lead_services ls

    INNER JOIN leads l
      ON l.id = ls.lead_id

    WHERE ls.lead_id = $1
      AND l.organization_id = $2
  `;

  if (role === "SALES_REP") {
    values.push(userId);

    query += `
      AND l.owner_user_id = $${values.length}
    `;
  }

  query += `
    ORDER BY ls.service_id
  `;

  const result = await pool.query(query, values);

  const serviceIds = result.rows.map((row) => Number(row.service_id));

  /*
   * Existing relationships can resolve inactive services.
   */

  const services = await getServicesFromServiceService(
    serviceIds,
    authorizationToken,
  );

  return services.sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || "")),
  );
}

/*
 * =========================================================
 * CHECK LEAD EXISTS / ACCESSIBLE
 * =========================================================
 */

async function leadExists(leadId, organizationId, userId, role) {
  const values = [leadId, organizationId];

  let query = `
    SELECT id
    FROM leads
    WHERE id = $1
      AND organization_id = $2
  `;

  if (role === "SALES_REP") {
    values.push(userId);

    query += `
      AND owner_user_id = $${values.length}
    `;
  }

  const result = await pool.query(query, values);

  return result.rows.length > 0;
}

/*
 * =========================================================
 * REPLACE LEAD SERVICES
 * =========================================================
 */

async function updateLeadServices(
  leadId,
  organizationId,
  userId,
  role,
  serviceIds,
  authorizationToken,
) {
  const normalizedServiceIds = Array.isArray(serviceIds)
    ? [
        ...new Set(
          serviceIds
            .map((serviceId) => Number(serviceId))
            .filter((serviceId) => Number.isInteger(serviceId)),
        ),
      ]
    : [];

  /*
   * NEW RELATIONSHIP:
   *
   * Every service being assigned must be Active.
   *
   * This validation occurs before the DB transaction.
   */

  await validateActiveServices(normalizedServiceIds, authorizationToken);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const leadValues = [leadId, organizationId];

    let leadQuery = `
      SELECT id
      FROM leads
      WHERE id = $1
        AND organization_id = $2
    `;

    if (role === "SALES_REP") {
      leadValues.push(userId);

      leadQuery += `
        AND owner_user_id = $${leadValues.length}
      `;
    }

    const lead = await client.query(leadQuery, leadValues);

    if (lead.rows.length === 0) {
      const error = new Error("Lead not found");

      error.statusCode = 404;

      throw error;
    }

    /*
     * Replace existing mappings.
     */

    await client.query(
      `
      DELETE FROM lead_services
      WHERE lead_id = $1
      `,
      [leadId],
    );

    for (const serviceId of normalizedServiceIds) {
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
      serviceIds: normalizedServiceIds,
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
 */

async function convertLead(
  leadId,
  organizationId,
  userId,
  role,
  authorizationToken,
) {
  const client = await pool.connect();

  try {
    const leadResult = await client.query(
      `
      SELECT
        id,
        organization_id,
        owner_user_id,
        name,
        company,
        email,
        phone,
        status
      FROM leads
      WHERE id = $1
        AND organization_id = $2
        ${role === "SALES_REP" ? "AND owner_user_id = $3" : ""}
      FOR UPDATE
      `,
      role === "SALES_REP"
        ? [leadId, organizationId, userId]
        : [leadId, organizationId],
    );

    if (leadResult.rows.length === 0) {
      const error = new Error("Lead not found");

      error.statusCode = 404;

      throw error;
    }

    const lead = leadResult.rows[0];

    if (lead.status === "Converted") {
      const error = new Error("Lead has already been converted");

      error.statusCode = 400;

      throw error;
    }

    const servicesResult = await client.query(
      `
      SELECT service_id
      FROM lead_services
      WHERE lead_id = $1
      ORDER BY service_id
      `,
      [lead.id],
    );

    const serviceIds = servicesResult.rows.map((row) => Number(row.service_id));

    client.release();

    const response = await fetch(
      `${CUSTOMER_SERVICE_URL}/customers/from-lead`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authorizationToken}`,
        },
        body: JSON.stringify({
          name: lead.name,
          company: lead.company,
          email: lead.email,
          phone: lead.phone,
          serviceIds,
        }),
      },
    );

    let responseBody = {};

    try {
      responseBody = await response.json();
    } catch (error) {
      responseBody = {};
    }

    if (!response.ok) {
      const error = new Error(
        responseBody.error ||
          responseBody.message ||
          "Customer Service failed to create customer",
      );

      error.statusCode = response.status;

      throw error;
    }

    const customer = responseBody.customer;

    const updateClient = await pool.connect();

    try {
      await updateClient.query("BEGIN");

      const updateResult = await updateClient.query(
        `
        UPDATE leads
        SET
          status = 'Converted',
          updated_at = NOW()
        WHERE id = $1
          AND organization_id = $2
          AND status <> 'Converted'
          ${role === "SALES_REP" ? "AND owner_user_id = $3" : ""}
        RETURNING *
        `,
        role === "SALES_REP"
          ? [leadId, organizationId, userId]
          : [leadId, organizationId],
      );

      if (updateResult.rows.length === 0) {
        await updateClient.query("ROLLBACK");

        const error = new Error("Lead could not be marked as converted");

        error.statusCode = 409;

        throw error;
      }

      await updateClient.query("COMMIT");

      return {
        message: "Lead converted to customer successfully",
        lead: updateResult.rows[0],
        customer,
      };
    } catch (error) {
      try {
        await updateClient.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(
          "[ERROR] Failed to rollback lead conversion update:",
          rollbackError,
        );
      }

      throw error;
    } finally {
      updateClient.release();
    }
  } catch (error) {
    /*
     * The original client is released before the HTTP call.
     */

    throw error;
  }
}

/*
 * =========================================================
 * DELETE LEAD
 * =========================================================
 */

async function deleteLead(leadId, organizationId, userId, role) {
  const values = [leadId, organizationId];

  let query = `
    DELETE FROM leads
    WHERE id = $1
      AND organization_id = $2
  `;

  if (role === "SALES_REP") {
    values.push(userId);

    query += `
      AND owner_user_id = $${values.length}
    `;
  }

  query += `
    RETURNING id
  `;

  const result = await pool.query(query, values);

  return result.rows[0] || null;
}

/*
 * =========================================================
 * EXPORTS
 * =========================================================
 */

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
