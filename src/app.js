const express = require("express");
const cors = require("cors");

const requestLogger = require("./middleware/requestLogger");
const leadRoutes = require("./routes/leadRoutes");

const app = express();

app.use(cors());

app.use(express.json());

app.use(requestLogger);

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "lead-service",
  });
});

app.use(leadRoutes);

module.exports = app;
