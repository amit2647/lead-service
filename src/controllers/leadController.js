const leadService = require("../services/leadService");
const { normalizeServiceIds } = require("../utils/serviceIds");

/*
 * =========================================================
 * HEALTH
 * =========================================================
 */

async function health(req, res) {
  try {
    await leadService.checkHealth();

    console.log("[HEALTH] Lead service healthy");

    res.json({
      service: "lead-service",
      status: "ok",
      database: "postgresql",
    });
  } catch (error) {
    console.error("[ERROR] Lead health check failed:", error);

    res.status(500).json({
      service: "lead-service",
      status: "error",
    });
  }
}

/*
 * =========================================================
 * AUTHORIZATION TOKEN
 * =========================================================
 *
 * Extract the JWT from:
 *
 *     Authorization: Bearer <token>
 *
 * The same token is forwarded to downstream services
 * such as Service Service and Customer Service.
 * =========================================================
 */

function getAuthorizationToken(req) {
  const authorization = req.headers.authorization;

  if (!authorization) {
    const error = new Error("Authentication required");

    error.statusCode = 401;

    throw error;
  }

  const parts = authorization.split(" ");

  if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
    const error = new Error("Invalid authorization header");

    error.statusCode = 401;

    throw error;
  }

  return parts[1];
}

/*
 * =========================================================
 * GET ALL LEADS
 * =========================================================
 */

async function getLeads(req, res) {
  try {
    const q = req.query.q || "";

    /*
     * Extract authenticated user's JWT.
     *
     * The token is required because Lead Service may need
     * to call Service Service to retrieve service details.
     */

    const token = getAuthorizationToken(req);

    const leads = await leadService.getAllLeads(
      req.auth.organizationId,
      req.auth.userId,
      req.auth.role,
      q,
      token,
    );

    res.json(leads);
  } catch (error) {
    console.error("[ERROR] Error fetching leads:", error);

    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : "Failed to fetch leads",
    });
  }
}

/*
 * =========================================================
 * GET LEAD
 * =========================================================
 */

async function getLead(req, res) {
  try {
    /*
     * Extract JWT for Service Service communication.
     */

    const token = getAuthorizationToken(req);

    const lead = await leadService.getLeadById(
      req.params.id,
      req.auth.organizationId,
      req.auth.userId,
      req.auth.role,
      token,
    );

    if (!lead) {
      return res.status(404).json({
        error: "Lead not found",
      });
    }

    res.json(lead);
  } catch (error) {
    console.error("[ERROR] Error fetching lead:", error);

    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : "Failed to fetch lead",
    });
  }
}

/*
 * =========================================================
 * CREATE LEAD
 * =========================================================
 */

async function createLead(req, res) {
  try {
    const {
      name,
      company,
      email,
      phone,
      channel = "Website",
      status = "New",
      score = 0,
      serviceIds = [],
    } = req.body;

    /*
     * -------------------------------------------------------
     * Validate name
     * -------------------------------------------------------
     */

    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        error: "Name is required",
      });
    }

    /*
     * -------------------------------------------------------
     * Validate service IDs
     * -------------------------------------------------------
     *
     * normalizeServiceIds() performs local shape validation.
     *
     * Actual service existence is validated by Lead Service
     * through Service Service.
     */

    const normalizedServiceIds = normalizeServiceIds(serviceIds);

    if (normalizedServiceIds === null) {
      return res.status(400).json({
        error: "serviceIds must be an array of positive integers",
      });
    }

    /*
     * -------------------------------------------------------
     * Extract JWT
     * -------------------------------------------------------
     *
     * The JWT is forwarded by Lead Service to Service Service
     * for service validation.
     */

    const token = getAuthorizationToken(req);

    /*
     * -------------------------------------------------------
     * Create lead
     * -------------------------------------------------------
     *
     * organizationId and ownerUserId are NEVER taken from
     * the browser request body.
     *
     * They come from the authenticated JWT.
     * -------------------------------------------------------
     */

    const lead = await leadService.createLead(
      {
        organizationId: req.auth.organizationId,

        ownerUserId: req.auth.userId,

        name,
        company,
        email,
        phone,
        channel,
        status,
        score,

        serviceIds: normalizedServiceIds,
      },
      token,
    );

    res.status(201).json(lead);
  } catch (error) {
    console.error("[ERROR] Error creating lead:", error);

    /*
     * Service Service validation error.
     *
     * Example:
     *
     * Service 99999 not found
     */

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
      });
    }

    /*
     * PostgreSQL FK violation.
     *
     * This may still occur while the lead_services FK
     * references the shared services table.
     *
     * It is retained for backward compatibility until
     * the database-level cross-service FK is removed.
     */

    if (error.code === "23503") {
      return res.status(400).json({
        error: "One or more service IDs are invalid",
      });
    }

    res.status(500).json({
      error: "Failed to create lead",
    });
  }
}

/*
 * =========================================================
 * UPDATE LEAD
 * =========================================================
 */

async function updateLead(req, res) {
  try {
    const { name, company, email, phone, channel, status, score } = req.body;

    /*
     * Validate name if supplied.
     */

    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      return res.status(400).json({
        error: "Name cannot be empty",
      });
    }

    const lead = await leadService.updateLead(
      req.params.id,

      req.auth.organizationId,

      req.auth.userId,

      req.auth.role,

      {
        name,
        company,
        email,
        phone,
        channel,
        status,
        score,
      },
    );

    if (!lead) {
      return res.status(404).json({
        error: "Lead not found",
      });
    }

    res.json(lead);
  } catch (error) {
    console.error("[ERROR] Error updating lead:", error);

    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : "Failed to update lead",
    });
  }
}

/*
 * =========================================================
 * VALIDATE LEAD
 * =========================================================
 *
 * Used by other services that need to verify that a lead
 * exists and belongs to the authenticated organization.
 *
 * This endpoint does NOT expose the full lead record.
 *
 * It only answers:
 *
 *     Does this lead exist?
 *
 * and:
 *
 *     Does it belong to this organization?
 * =========================================================
 */

async function validateLead(req, res) {
  try {
    const exists = await leadService.leadExists(
      req.params.id,
      req.auth.organizationId,
      req.auth.userId,
      req.auth.role,
    );

    if (!exists) {
      return res.status(404).json({
        valid: false,
        error: "Lead not found",
      });
    }

    return res.json({
      valid: true,
      leadId: Number(req.params.id),
      organizationId: req.auth.organizationId,
    });
  } catch (error) {
    console.error("[ERROR] Error validating lead:", error);

    return res.status(error.statusCode || 500).json({
      valid: false,
      error: error.statusCode ? error.message : "Failed to validate lead",
    });
  }
}

/*
 * =========================================================
 * GET LEAD SERVICES
 * =========================================================
 */

async function getLeadServices(req, res) {
  try {
    /*
     * First verify that the authenticated user can access
     * this lead.
     */

    const exists = await leadService.leadExists(
      req.params.id,
      req.auth.organizationId,
      req.auth.userId,
      req.auth.role,
    );

    if (!exists) {
      return res.status(404).json({
        error: "Lead not found",
      });
    }

    /*
     * Extract JWT.
     *
     * Lead Service forwards it to Service Service when
     * retrieving service details.
     */

    const token = getAuthorizationToken(req);

    const services = await leadService.getLeadServices(
      req.params.id,
      req.auth.organizationId,
      req.auth.userId,
      req.auth.role,
      token,
    );

    res.json(services);
  } catch (error) {
    console.error("[ERROR] Error fetching lead services:", error);

    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : "Failed to fetch lead services",
    });
  }
}

/*
 * =========================================================
 * UPDATE LEAD SERVICES
 * =========================================================
 */

async function updateLeadServices(req, res) {
  try {
    /*
     * Normalize and validate the service ID array.
     */

    const serviceIds = normalizeServiceIds(req.body.serviceIds ?? []);

    if (serviceIds === null) {
      return res.status(400).json({
        error: "serviceIds must be an array of positive integers",
      });
    }

    /*
     * Extract JWT.
     *
     * Lead Service uses this token when asking Service
     * Service to validate the supplied service IDs.
     */

    const token = getAuthorizationToken(req);

    const result = await leadService.updateLeadServices(
      req.params.id,

      req.auth.organizationId,

      req.auth.userId,

      req.auth.role,

      serviceIds,

      token,
    );

    res.json(result);
  } catch (error) {
    console.error("[ERROR] Error updating lead services:", error);

    res.status(error.statusCode || 500).json({
      error: error.statusCode
        ? error.message
        : "Failed to update lead services",
    });
  }
}

/*
 * =========================================================
 * CONVERT LEAD
 * =========================================================
 *
 * Lead Service → Customer Service
 *
 * Customer Service owns customer creation.
 * Lead Service owns lead conversion state.
 * =========================================================
 */

async function convertLead(req, res) {
  try {
    /*
     * Extract JWT using the common helper.
     *
     * The same JWT is forwarded to Customer Service.
     */

    const token = getAuthorizationToken(req);

    const result = await leadService.convertLead(
      req.params.id,

      req.auth.organizationId,

      req.auth.userId,

      req.auth.role,

      token,
    );

    res.json(result);
  } catch (error) {
    console.error("[ERROR] Lead conversion failed:", error);

    res.status(error.statusCode || 500).json({
      error: error.statusCode
        ? error.message
        : "Failed to convert lead to customer",
    });
  }
}

/*
 * =========================================================
 * DELETE LEAD
 * =========================================================
 */

async function deleteLead(req, res) {
  try {
    const lead = await leadService.deleteLead(
      req.params.id,

      req.auth.organizationId,

      req.auth.userId,

      req.auth.role,
    );

    if (!lead) {
      return res.status(404).json({
        error: "Lead not found",
      });
    }

    res.json({
      message: "Lead deleted",
      id: lead.id,
    });
  } catch (error) {
    console.error("[ERROR] Error deleting lead:", error);

    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : "Failed to delete lead",
    });
  }
}

/*
 * =========================================================
 * EXPORTS
 * =========================================================
 */

module.exports = {
  health,
  getLeads,
  validateLead,
  getLead,
  createLead,
  updateLead,
  getLeadServices,
  updateLeadServices,
  convertLead,
  deleteLead,
};
