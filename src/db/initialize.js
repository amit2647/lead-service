const pool = require("../config/database");

async function initializeDatabase() {
  console.log("[DB] Initializing lead database...");

  /*
   * =======================================================
   * LEADS
   * =======================================================
   *
   * The table may already exist from an earlier version
   * of the application.
   *
   * Therefore we create it only when necessary and then
   * apply the required schema migrations below.
   * =======================================================
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,

      organization_id INTEGER,
      owner_user_id INTEGER,

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
   * MIGRATION: ORGANIZATION ID
   * =======================================================
   *
   * Existing installations may not have organization_id.
   * =======================================================
   */

  await pool.query(`
    ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS organization_id INTEGER;
  `);

  /*
   * =======================================================
   * MIGRATION: OWNER USER ID
   * =======================================================
   */

  await pool.query(`
    ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS owner_user_id INTEGER;
  `);

  /*
   * =======================================================
   * MIGRATION: EXISTING LEADS
   * =======================================================
   *
   * Existing MVP leads belong to the initial organization.
   *
   * Organization 1 is the Acme Corporation organization
   * created during the Identity Service setup.
   *
   * Only NULL values are updated, so existing assignments
   * are not overwritten.
   * =======================================================
   */

  const organizationResult = await pool.query(`
    SELECT id
    FROM organizations
    ORDER BY id
    LIMIT 1
  `);

  if (organizationResult.rows.length === 0) {
    throw new Error(
      "No organization exists. Create an organization before initializing the Lead Service.",
    );
  }

  const defaultOrganizationId = organizationResult.rows[0].id;

  await pool.query(
    `
    UPDATE leads
    SET organization_id = $1
    WHERE organization_id IS NULL
    `,
    [defaultOrganizationId],
  );

  /*
   * =======================================================
   * MIGRATION: ORGANIZATION NOT NULL
   * =======================================================
   */

  await pool.query(`
    ALTER TABLE leads
    ALTER COLUMN organization_id SET NOT NULL;
  `);

  /*
   * =======================================================
   * MIGRATION: ORGANIZATION FOREIGN KEY
   * =======================================================
   *
   * PostgreSQL does not support:
   *
   * ADD CONSTRAINT IF NOT EXISTS
   *
   * so we check pg_constraint first.
   * =======================================================
   */

  const organizationConstraintResult = await pool.query(`
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'leads_organization_fk'
        AND conrelid = 'leads'::regclass
    `);

  if (organizationConstraintResult.rows.length === 0) {
    await pool.query(`
      ALTER TABLE leads
      ADD CONSTRAINT leads_organization_fk
      FOREIGN KEY (organization_id)
      REFERENCES organizations(id)
      ON DELETE CASCADE
    `);
  }

  /*
   * =======================================================
   * INDEXES
   * =======================================================
   */

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_leads_organization_id
    ON leads(organization_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_leads_owner_user_id
    ON leads(owner_user_id);
  `);

  /*
   * =======================================================
   * LEAD ↔ SERVICE
   * =======================================================
   *
   * NOTE:
   *
   * services is currently owned by service-service but
   * remains in the shared PostgreSQL database for this
   * MVP phase.
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
      `,
      [
        defaultOrganizationId,
        null,
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

  /*
   * =======================================================
   * FINAL VALIDATION
   * =======================================================
   */

  const schemaCheck = await pool.query(`
    SELECT
      COUNT(*) FILTER (
        WHERE organization_id IS NULL
      )::int AS missing_organization_ids,

      COUNT(*)::int AS total_leads
    FROM leads
  `);

  const { missing_organization_ids, total_leads } = schemaCheck.rows[0];

  if (missing_organization_ids > 0) {
    throw new Error(
      `Lead database initialization failed: ${missing_organization_ids} leads have no organization_id`,
    );
  }

  console.log(`[DB] Lead database ready (${total_leads} leads)`);
}

module.exports = {
  initializeDatabase,
};
