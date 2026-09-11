const express = require("express");
const cors = require("cors");

const requestLogger = require("./middleware/requestLogger");
const leadRoutes = require("./routes/leadRoutes");

const app = express();

app.use(cors());

app.use(express.json());

app.use(requestLogger);

app.use(leadRoutes);

module.exports = app;
