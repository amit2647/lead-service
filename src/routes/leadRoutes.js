const express = require("express");

const controller = require("../controllers/leadController");

const router = express.Router();

/*
 * Health
 */

router.get("/health", controller.health);

/*
 * Leads
 */

router.get("/leads", controller.getLeads);

router.get("/leads/:id", controller.getLead);

router.post("/leads", controller.createLead);

router.patch("/leads/:id", controller.updateLead);

router.delete("/leads/:id", controller.deleteLead);

/*
 * Lead services
 */

router.get("/leads/:id/services", controller.getLeadServices);

router.put("/leads/:id/services", controller.updateLeadServices);

/*
 * Lead conversion
 */

router.post("/leads/:id/convert", controller.convertLead);

module.exports = router;
