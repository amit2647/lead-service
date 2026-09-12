const express = require("express");
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

module.exports = router;
