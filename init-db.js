const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const createTablesSQL = `
-- Table HOSTS
CREATE TABLE IF NOT EXISTS hosts (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table CLIENTS
CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table CONNEXIONS (relation host-client)
CREATE TABLE IF NOT EXISTS connexions (
    id SERIAL PRIMARY KEY,
    host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
    client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(host_id, client_id)
);

-- Table MEETINGS (créneaux horaires)
CREATE TABLE IF NOT EXISTS meetings (
    id SERIAL PRIMARY KEY,
    host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
    start TIMESTAMP NOT NULL,
    duration FLOAT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table RESULTS (résultats de planification)
CREATE TABLE IF NOT EXISTS results (
    id SERIAL PRIMARY KEY,
    meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
    client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
    fixed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(meeting_id, client_id)
);

-- Table DISPONIBILITIES (disponibilités des clients)
CREATE TABLE IF NOT EXISTS disponibilities (
    id SERIAL PRIMARY KEY,
    meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
    client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
    cost FLOAT NOT NULL CHECK (cost >= 0 AND cost <= 100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(meeting_id, client_id)
);

-- Index pour performances
CREATE INDEX IF NOT EXISTS idx_meetings_host ON meetings(host_id);
CREATE INDEX IF NOT EXISTS idx_results_meeting ON results(meeting_id);
CREATE INDEX IF NOT EXISTS idx_results_client ON results(client_id);
CREATE INDEX IF NOT EXISTS idx_disponibilities_meeting ON disponibilities(meeting_id);
CREATE INDEX IF NOT EXISTS idx_disponibilities_client ON disponibilities(client_id);
CREATE INDEX IF NOT EXISTS idx_connexions_host ON connexions(host_id);
CREATE INDEX IF NOT EXISTS idx_connexions_client ON connexions(client_id);
`;



async function initializeDatabase() {
    const client = await pool.connect();
    
    try {
        console.log('🔄 Création des tables...');
        await client.query(createTablesSQL);
        console.log('✅ Tables créées avec succès');
        
        
        console.log('\n📊 Récapitulatif:');
        const hostsCount = await client.query('SELECT COUNT(*) FROM hosts');
        const clientsCount = await client.query('SELECT COUNT(*) FROM clients');
        const meetingsCount = await client.query('SELECT COUNT(*) FROM meetings');
        
        console.log(`   • Hôtes: ${hostsCount.rows[0].count}`);
        console.log(`   • Clients: ${clientsCount.rows[0].count}`);
        console.log(`   • Créneaux: ${meetingsCount.rows[0].count}`);
        
        console.log('\n✨ Base de données initialisée avec succès!');
        
    } catch (error) {
        console.error('❌ Erreur lors de l\'initialisation:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

initializeDatabase().catch(console.error);
