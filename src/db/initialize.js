const pool = require("../config/database");

async function initializeDatabase() {
  console.log("[DB] Initializing lead database...");

  /*
   * =======================================================
   * LEADS
   * =======================================================
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      company VARCHAR(150),
      email VARCHAR(255),
      phone VARCHAR(50),
      channel VARCHAR(50) DEFAULT 'Website',
      status VARCHAR(50) DEFAULT 'New',
      score INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  /*
   * =======================================================
   * LEAD ↔ SERVICE
   *
   * NOTE:
   * services is owned by service-service.
   * =======================================================
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lead_services (
      lead_id INTEGER NOT NULL,
      service_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      PRIMARY KEY (lead_id, service_id),

      CONSTRAINT fk_lead_services_lead
        FOREIGN KEY (lead_id)
        REFERENCES leads(id)
        ON DELETE CASCADE,

      CONSTRAINT fk_lead_services_service
        FOREIGN KEY (service_id)
        REFERENCES services(id)
        ON DELETE CASCADE
    );
  `);

  /*
   * =======================================================
   * SEED INITIAL LEAD
   * =======================================================
   */

  const result = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM leads
  `);

  if (result.rows[0].count === 0) {
    await pool.query(
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
      `,
      [
        "Priya Sharma",
        "Acme Digital",
        "priya@example.com",
        "9876543210",
        "WhatsApp",
        "Qualified",
        86,
      ],
    );

    console.log("[LEAD] Initial lead created");
  }

  console.log("[DB] Lead database ready");
}

module.exports = {
  initializeDatabase,
};
