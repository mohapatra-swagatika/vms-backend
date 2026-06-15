/**
 * reseed.js — wipes all non-system data and inserts clean test data
 * Run: node scripts/reseed.js
 */
const pool   = require('../src/db/pool');
const bcrypt = require('bcrypt');

const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10');
const hash   = (pwd) => bcrypt.hash(pwd, ROUNDS);

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── 1. Wipe all data (order matters for FK constraints) ──────────────────
    await client.query('DELETE FROM user_role_assignments');
    // Null out created_by before deleting users (FK on entity tables)
    await client.query('UPDATE towers        SET created_by = NULL');
    await client.query('UPDATE companies     SET created_by = NULL');
    await client.query('UPDATE organizations SET created_by = NULL');
    await client.query('UPDATE locations     SET created_by = NULL');
    await client.query('DELETE FROM locations');
    await client.query('DELETE FROM companies');
    await client.query('DELETE FROM organizations');
    await client.query('DELETE FROM towers');
    await client.query('UPDATE roles SET created_by = NULL');
    await client.query('DELETE FROM roles WHERE is_system = false');
    await client.query('DELETE FROM users');
    console.log('✓ Cleared existing data');

    // ── 2. Towers ────────────────────────────────────────────────────────────
    const { rows: [towerA] } = await client.query(`
      INSERT INTO towers (name, address) VALUES
        ('Cyber Hub', 'DLF Cyber Hub, Sector 24, Gurugram, Haryana - 122002')
      RETURNING id`);

    const { rows: [towerB] } = await client.query(`
      INSERT INTO towers (name, address) VALUES
        ('Express Trade Tower', 'B-36, Sector 132, Noida, UP - 201304')
      RETURNING id`);

    console.log('✓ Towers created:', towerA.id, towerB.id);

    // ── 3. Companies ─────────────────────────────────────────────────────────
    const approvalChain2step = JSON.stringify({
      bypass_enabled: true,
      steps: [
        { step: 1, level: 400, label: 'Admin approval' },
        { step: 2, level: 600, label: 'Company approval' },
      ],
    });
    const approvalChain1step = JSON.stringify({
      bypass_enabled: false,
      steps: [{ step: 1, level: 400, label: 'Admin approval' }],
    });
    const noChain = JSON.stringify({ bypass_enabled: false, steps: [] });

    const { rows: [compTechCorp] } = await client.query(`
      INSERT INTO companies (tower_id, name, address, approval_chain) VALUES
        ($1, 'TechCorp India Pvt Ltd', 'Block A, Cyber Hub, Gurugram', $2)
      RETURNING id`, [towerA.id, approvalChain2step]);

    const { rows: [compFinServ] } = await client.query(`
      INSERT INTO companies (tower_id, name, address, approval_chain) VALUES
        ($1, 'FinServ Solutions', 'Block B, Cyber Hub, Gurugram', $2)
      RETURNING id`, [towerA.id, approvalChain1step]);

    const { rows: [compReliable] } = await client.query(`
      INSERT INTO companies (tower_id, name, address, approval_chain) VALUES
        ($1, 'Reliable Systems', '4th Floor, ETT, Noida', $2)
      RETURNING id`, [towerB.id, noChain]);

    console.log('✓ Companies created');

    // ── 4. Organizations ─────────────────────────────────────────────────────
    const { rows: [orgNorth] } = await client.query(`
      INSERT INTO organizations (name, address) VALUES
        ('North Zone Healthcare', 'Sector 14, Gurugram, Haryana - 122001')
      RETURNING id`);

    const { rows: [orgSouth] } = await client.query(`
      INSERT INTO organizations (name, address) VALUES
        ('South Zone Retail', 'Koramangala, Bengaluru, Karnataka - 560034')
      RETURNING id`);

    console.log('✓ Organizations created');

    // ── 5. Locations ─────────────────────────────────────────────────────────
    const { rows: [locApollo] } = await client.query(`
      INSERT INTO locations (organization_id, name, address, approval_chain) VALUES
        ($1, 'Apollo Clinic – Sector 14', 'Plot 12, Sector 14, Gurugram', $2)
      RETURNING id`, [orgNorth.id, approvalChain1step]);

    const { rows: [locMax] } = await client.query(`
      INSERT INTO locations (organization_id, name, address, approval_chain) VALUES
        ($1, 'Max Hospital – DLF Phase 2', 'DLF Phase 2, Gurugram', $2)
      RETURNING id`, [orgNorth.id, approvalChain2step]);

    const { rows: [locPhoenix] } = await client.query(`
      INSERT INTO locations (organization_id, name, address, approval_chain) VALUES
        ($1, 'Phoenix Mall – Bengaluru', 'Whitefield Road, Bengaluru', $2)
      RETURNING id`, [orgSouth.id, noChain]);

    console.log('✓ Locations created');

    // ── 6. Lookup system role IDs ────────────────────────────────────────────
    const { rows: sysRoles } = await client.query('SELECT id, name FROM roles WHERE is_system = true');
    const roleId = {};
    sysRoles.forEach(r => roleId[r.name] = r.id);
    console.log('System roles:', Object.keys(roleId).join(', '));

    // ── 7. Custom roles ──────────────────────────────────────────────────────
    const { rows: [roleSecOfficer] } = await client.query(`
      INSERT INTO roles (name, display_name, level, entity_type, is_system, permissions, parent_role_id)
      VALUES ('security_officer', 'Security Officer', 120, 'any', false,
        '{"actions":["visitor:read","visit_request:read","visit_request:checkin","visit_request:checkout","qr:scan"],"not_actions":[]}',
        $1)
      RETURNING id`, [roleId['gate']]);

    const { rows: [roleSrAdmin] } = await client.query(`
      INSERT INTO roles (name, display_name, level, entity_type, is_system, permissions, parent_role_id)
      VALUES ('senior_admin', 'Senior Admin', 450, 'any', false,
        '{"actions":["user:create","user:read","user:update","user:delete","role:read","role:assign","report:view","report:export","visitor:read","visit_request:read","visit_request:approve","visit_request:reject","audit_log:read"],"not_actions":[]}',
        $1)
      RETURNING id`, [roleId['admin']]);

    console.log('✓ Custom roles created');

    // ── 8. Users ─────────────────────────────────────────────────────────────
    const users = [
      // Support — full global access
      { name: 'ThinkSys Support',    email: 'support@thinksys.com',    password: 'Support@1234',   phone: '+91 98100 00001' },
      // Tower admins
      { name: 'Arjun Mehta',         email: 'arjun@cyberhub.com',       password: 'Tower@1234',     phone: '+91 98100 00002' },
      { name: 'Sneha Kapoor',        email: 'sneha@expresstrade.com',    password: 'Tower@1234',     phone: '+91 98100 00003' },
      // Company managers
      { name: 'Priya Sharma',        email: 'priya@techcorp.com',        password: 'Company@1234',   phone: '+91 98100 00004' },
      { name: 'Rohit Verma',         email: 'rohit@finserv.com',         password: 'Company@1234',   phone: '+91 98100 00005' },
      { name: 'Kavita Singh',        email: 'kavita@reliable.com',       password: 'Company@1234',   phone: '+91 98100 00006' },
      // Org admins
      { name: 'Dr. Anil Gupta',      email: 'anil@northzone.com',        password: 'Org@12345',      phone: '+91 98100 00007' },
      { name: 'Meera Pillai',        email: 'meera@southzone.com',       password: 'Org@12345',      phone: '+91 98100 00008' },
      // Front desk
      { name: 'Ravi Receptionist',   email: 'ravi@techcorp.com',         password: 'Desk@1234',      phone: '+91 98100 00009' },
      { name: 'Sunita Front Desk',   email: 'sunita@apollo.com',         password: 'Desk@1234',      phone: '+91 98100 00010' },
      // Gate staff
      { name: 'Mohan Gate',          email: 'mohan.gate@cyberhub.com',   password: 'Gate@1234',      phone: '+91 98100 00011' },
      { name: 'Deepak Security',     email: 'deepak@reliable.com',       password: 'Gate@1234',      phone: '+91 98100 00012' },
      // Senior admin
      { name: 'Ananya Senior',       email: 'ananya@thinksys.com',       password: 'Admin@1234',     phone: '+91 98100 00013' },
    ];

    const createdUsers = {};
    for (const u of users) {
      const h = await hash(u.password);
      const { rows: [row] } = await client.query(
        `INSERT INTO users (email, password_hash, name, phone)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [u.email, h, u.name, u.phone]
      );
      createdUsers[u.email] = row.id;
      process.stdout.write('.');
    }
    console.log('\n✓ Users created');

    // ── 9. Role assignments ──────────────────────────────────────────────────
    const assign = async (email, roleName, scopeType, scopeId) => {
      const userId = createdUsers[email];
      const rId    = roleId[roleName] || (roleName === 'security_officer' ? roleSecOfficer.id : roleSrAdmin.id);
      await client.query(
        `INSERT INTO user_role_assignments (user_id, role_id, scope_type, scope_id, assigned_by)
         VALUES ($1, $2, $3, $4, $1)`,
        [userId, rId, scopeType, scopeId || null]
      );
    };

    // Support — global
    await assign('support@thinksys.com', 'support', 'global', null);

    // Tower admins
    await assign('arjun@cyberhub.com',    'tower',  'tower', towerA.id);
    await assign('sneha@expresstrade.com','tower',  'tower', towerB.id);

    // Company managers
    await assign('priya@techcorp.com',   'company', 'company', compTechCorp.id);
    await assign('rohit@finserv.com',    'company', 'company', compFinServ.id);
    await assign('kavita@reliable.com',  'company', 'company', compReliable.id);

    // Org admins
    await assign('anil@northzone.com',   'organization', 'organization', orgNorth.id);
    await assign('meera@southzone.com',  'organization', 'organization', orgSouth.id);

    // Front desk
    await assign('ravi@techcorp.com',    'front_desk', 'company', compTechCorp.id);
    await assign('sunita@apollo.com',    'front_desk', 'location', locApollo.id);

    // Gate staff
    await assign('mohan.gate@cyberhub.com', 'gate',             'company',  compTechCorp.id);
    await assign('deepak@reliable.com',     'security_officer', 'company',  compReliable.id);

    // Senior admin — scoped to TechCorp
    await assign('ananya@thinksys.com', 'senior_admin', 'company', compTechCorp.id);

    console.log('✓ Role assignments created');

    await client.query('COMMIT');
    console.log('\n════════════════════════════════════════════════');
    console.log('✅ Reseed complete! Test credentials:\n');
    console.log('ROLE            EMAIL                         PASSWORD');
    console.log('─────────────────────────────────────────────────────────');
    console.log('Support         support@thinksys.com          Support@1234');
    console.log('Tower (Cyber)   arjun@cyberhub.com            Tower@1234');
    console.log('Tower (ETT)     sneha@expresstrade.com        Tower@1234');
    console.log('Company Mgr     priya@techcorp.com            Company@1234');
    console.log('Company Mgr     rohit@finserv.com             Company@1234');
    console.log('Company Mgr     kavita@reliable.com           Company@1234');
    console.log('Org Admin       anil@northzone.com            Org@12345');
    console.log('Org Admin       meera@southzone.com           Org@12345');
    console.log('Front Desk      ravi@techcorp.com             Desk@1234');
    console.log('Front Desk      sunita@apollo.com             Desk@1234');
    console.log('Gate            mohan.gate@cyberhub.com       Gate@1234');
    console.log('Security Ofcr   deepak@reliable.com           Gate@1234');
    console.log('Senior Admin    ananya@thinksys.com           Admin@1234');
    console.log('════════════════════════════════════════════════');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Reseed failed — rolled back:', err.message);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}

run();
