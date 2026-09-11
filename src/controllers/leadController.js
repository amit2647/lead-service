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
 * GET ALL LEADS
 * =========================================================
 */

async function getLeads(req, res) {
  try {
    const q = req.query.q || "";

    const leads = await leadService.getAllLeads(q);

    res.json(leads);
  } catch (error) {
    console.error("[ERROR] Error fetching leads:", error);

    res.status(500).json({
      error: "Failed to fetch leads",
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
    const lead = await leadService.getLeadById(req.params.id);

    if (!lead) {
      return res.status(404).json({
        error: "Lead not found",
      });
    }

    res.json(lead);
  } catch (error) {
    console.error("[ERROR] Error fetching lead:", error);

    res.status(500).json({
      error: "Failed to fetch lead",
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
     * Validate name.
     */

    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        error: "Name is required",
      });
    }

    /*
     * Validate service IDs.
     */

    const normalizedServiceIds = normalizeServiceIds(serviceIds);

    if (normalizedServiceIds === null) {
      return res.status(400).json({
        error: "serviceIds must be an array of positive integers",
      });
    }

    const lead = await leadService.createLead({
      name,
      company,
      email,
      phone,
      channel,
      status,
      score,
      serviceIds: normalizedServiceIds,
    });

    res.status(201).json(lead);
  } catch (error) {
    console.error("[ERROR] Error creating lead:", error);

    /*
     * PostgreSQL FK violation.
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

    const lead = await leadService.updateLead(req.params.id, {
      name,
      company,
      email,
      phone,
      channel,
      status,
      score,
    });

    if (!lead) {
      return res.status(404).json({
        error: "Lead not found",
      });
    }

    res.json(lead);
  } catch (error) {
    console.error("[ERROR] Error updating lead:", error);

    res.status(500).json({
      error: "Failed to update lead",
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
    const exists = await leadService.leadExists(req.params.id);

    if (!exists) {
      return res.status(404).json({
        error: "Lead not found",
      });
    }

    const services = await leadService.getLeadServices(req.params.id);

    res.json(services);
  } catch (error) {
    console.error("[ERROR] Error fetching lead services:", error);

    res.status(500).json({
      error: "Failed to fetch lead services",
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
    const serviceIds = normalizeServiceIds(req.body.serviceIds ?? []);

    if (serviceIds === null) {
      return res.status(400).json({
        error: "serviceIds must be an array of positive integers",
      });
    }

    const result = await leadService.updateLeadServices(
      req.params.id,
      serviceIds,
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
 */

async function convertLead(req, res) {
  try {
    const result = await leadService.convertLead(req.params.id);

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
    const lead = await leadService.deleteLead(req.params.id);

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

    res.status(500).json({
      error: "Failed to delete lead",
    });
  }
}

module.exports = {
  health,
  getLeads,
  getLead,
  createLead,
  updateLead,
  getLeadServices,
  updateLeadServices,
  convertLead,
  deleteLead,
};
