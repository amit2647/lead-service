const express = require("express");

const requireBundle = require("../middleware/requireBundle");
const { updateProspect } = require("../services/prospectService");
const controller = require("../controllers/leadController");
const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");

const router = express.Router();

router.get(
  "/leads",
  authenticate,
  requirePermission("leads.read"),
  controller.getLeads,
);

router.get(
  "/leads/:id/validate",
  authenticate,
  requirePermission("leads.read"),
  controller.validateLead,
);

router.get(
  "/leads/:id",
  authenticate,
  requirePermission("leads.read"),
  controller.getLead,
);

router.post(
  "/leads",
  authenticate,
  requirePermission("leads.create"),
  controller.createLead,
);

router.patch(
  "/leads/:id",
  authenticate,
  requirePermission("leads.update"),
  controller.updateLead,
);

router.delete(
  "/leads/:id",
  authenticate,
  requirePermission("leads.delete"),
  controller.deleteLead,
);

router.get(
  "/leads/:id/services",
  authenticate,
  requirePermission("leads.read"),
  controller.getLeadServices,
);

router.put(
  "/leads/:id/services",
  authenticate,
  requirePermission("leads.update"),
  controller.updateLeadServices,
);

router.post(
  "/leads/:id/convert",
  authenticate,
  requirePermission("leads.update"),
  controller.convertLead,
);

/*
 * The prospect board (organizations with a profession bundle only): move a
 * lead between the bundle's pipeline columns and keep its quote, next
 * meeting and notes (PROS-01–03).
 */
router.patch(
  "/leads/:id/prospect",
  authenticate,
  requirePermission("leads.update"),
  requireBundle,
  async (req, res) => {
    try {
      const leadId = Number(req.params.id);

      if (!Number.isInteger(leadId) || leadId <= 0) {
        return res.status(400).json({ error: "Invalid lead ID" });
      }

      const lead = await updateProspect(req.auth, req.bundle, leadId, req.body || {});

      return res.json(lead);
    } catch (error) {
      if (!error.statusCode) console.error("[Prospect]", error);

      return res.status(error.statusCode || 500).json({
        error: error.statusCode ? error.message : "The prospect could not be updated",
        ...(error.details ? { details: error.details } : {}),
      });
    }
  },
);

module.exports = router;
