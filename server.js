const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration PostgreSQL
const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Configuration email
const transporter = nodemailer.createTransport({
	host: process.env.SMTP_HOST,
	port: process.env.SMTP_PORT,
	secure: false,
	auth: {
		user: process.env.SMTP_USER,
		pass: process.env.SMTP_PASS
	}
});

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Middleware d'authentification
const authenticateHost = (req, res, next) => {
	const token = req.headers.authorization?.split(' ')[1];
	
	if (!token) {
		return res.status(401).json({ error: 'Token manquant' });
	}
	
	try {
		const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret-key');
		req.hostId = decoded.hostId;
		next();
	} catch (error) {
		return res.status(401).json({ error: 'Token invalide' });
	}
};

// ==================== ROUTES AUTHENTIFICATION ====================

// Inscription hôte
app.post('/api/host/register', async (req, res) => {
	const { name, email, password } = req.body;
	
	try {
		// Vérifier si l'email existe déjà
		const existingHost = await pool.query(
			'SELECT id FROM hosts WHERE email = $1',
			[email]
		);
		
		if (existingHost.rows.length > 0) {
			return res.status(400).json({ message: 'Cet email est déjà utilisé' });
		}
		
		// Hasher le mot de passe
		const hashedPassword = await bcrypt.hash(password, 10);
		
		// Créer l'hôte
		const result = await pool.query(
			'INSERT INTO hosts (name, email, password) VALUES ($1, $2, $3) RETURNING id',
			[name, email, hashedPassword]
		);
		
		res.status(201).json({ 
			hostId: result.rows[0].id,
			message: 'Compte créé avec succès'
		});
	} catch (error) {
		console.error('Erreur inscription:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// Connexion hôte
app.post('/api/host/login', async (req, res) => {
	const { email, password } = req.body;
	
	try {
		const result = await pool.query(
			'SELECT id, name, password FROM hosts WHERE email = $1',
			[email]
		);
		
		if (result.rows.length === 0) {
			return res.status(401).json({ error: 'Identifiants incorrects' });
		}
		
		const host = result.rows[0];
		const validPassword = await bcrypt.compare(password, host.password);
		
		if (!validPassword) {
			return res.status(401).json({ error: 'Identifiants incorrects' });
		}
		
		const token = jwt.sign(
			{ hostId: host.id },
			process.env.JWT_SECRET || 'secret-key',
			{ expiresIn: '7d' }
		);
		
		res.json({ token, hostId: host.id });
	} catch (error) {
		console.error('Erreur connexion:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// ==================== ROUTES HÔTE ====================

// Récupérer infos hôte
app.get('/api/host/:hostId', async (req, res) => {
	const { hostId } = req.params;
	
	try {
		const result = await pool.query(
			'SELECT id, name, email FROM hosts WHERE id = $1',
			[hostId]
		);
		
		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Hôte non trouvé' });
		}
		
		res.json(result.rows[0]);
	} catch (error) {
		console.error('Erreur:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// Rechercher des clients (pour suggestions)
app.get('/api/clients/search', authenticateHost, async (req, res) => {
	const { q } = req.query;
	
	if (!q || q.length < 2) {
		return res.json([]);
	}
	
	try {
		const result = await pool.query(`
			SELECT id, name, email 
			FROM clients 
			WHERE LOWER(name) LIKE LOWER($1) OR LOWER(email) LIKE LOWER($1)
			LIMIT 10
		`, [`%${q}%`]);
		
		// Retourner avec référence cryptée au lieu de l'ID réel
		const clients = result.rows.map(client => ({
			ref: Buffer.from(client.id).toString('base64'),
			name: client.name,
			email: client.email
		}));
		
		res.json(clients);
	} catch (error) {
		console.error('Erreur:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// Récupérer les clients d'un hôte
app.get('/api/host/:hostId/clients', authenticateHost, async (req, res) => {
	const { hostId } = req.params;
	
	try {
		const result = await pool.query(`
			SELECT c.id, c.name, c.email 
			FROM clients c
			INNER JOIN connexions cn ON c.id = cn.client_id
			WHERE cn.host_id = $1
			ORDER BY c.name
		`, [hostId]);
		
		// Retourner avec référence cryptée au lieu de l'ID réel
		const clients = result.rows.map(client => ({
			ref: Buffer.from(client.id).toString('base64'),
			name: client.name,
			email: client.email
		}));
		
		res.json(clients);
	} catch (error) {
		console.error('Erreur:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// Ajouter un client
app.post('/api/host/:hostId/clients', authenticateHost, async (req, res) => {
	const { hostId } = req.params;
	const { name, email } = req.body;
	
	const client = await pool.connect();
	
	try {
		await client.query('BEGIN');
		
		// Vérifier si l'email existe déjà
		const existingClient = await client.query(
			'SELECT id FROM clients WHERE email = $1',
			[email]
		);
		
		if (existingClient.rows.length > 0) {
			await client.query('ROLLBACK');
			return res.status(400).json({ message: 'Un client avec cet email existe déjà' });
		}
		
		// Générer un ID unique
		const clientId = await generateUniqueClientId(client);
		
		console.log(`[BACKEND] Nouveau client créé - ID: ${clientId}, Nom: ${name}, Email: ${email}`);
		
		// Créer le client
		await client.query(
			'INSERT INTO clients (id, name, email) VALUES ($1, $2, $3)',
			[clientId, name, email]
		);
		
		// Créer la connexion
		await client.query(
			'INSERT INTO connexions (host_id, client_id) VALUES ($1, $2)',
			[hostId, clientId]
		);
		
		await client.query('COMMIT');
		
		// Récupérer les infos de l'hôte pour l'email
		const hostResult = await pool.query(
			'SELECT name FROM hosts WHERE id = $1',
			[hostId]
		);
		const hostName = hostResult.rows[0]?.name || 'Votre hôte';
		
		// Envoyer l'email avec le lien d'accès
		await sendWelcomeEmail(clientId, name, email, hostName);
		
		res.status(201).json({ success: true });
	} catch (error) {
		await client.query('ROLLBACK');
		console.error('Erreur:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	} finally {
		client.release();
	}
});

// Connecter un client existant à un hôte
app.post('/api/host/:hostId/clients/connect', authenticateHost, async (req, res) => {
	const { hostId } = req.params;
	const { clientRef } = req.body;
	
	try {
		// Décoder la référence
		const clientId = Buffer.from(clientRef, 'base64').toString('utf-8');
		
		// Vérifier si la connexion existe déjà
		const existingConnection = await pool.query(
			'SELECT id FROM connexions WHERE host_id = $1 AND client_id = $2',
			[hostId, clientId]
		);
		
		if (existingConnection.rows.length > 0) {
			return res.status(400).json({ message: 'Ce client est déjà associé à votre compte' });
		}
		
		// Récupérer les infos du client et de l'hôte
		const clientResult = await pool.query(
			'SELECT name, email FROM clients WHERE id = $1',
			[clientId]
		);
		
		if (clientResult.rows.length === 0) {
			return res.status(404).json({ message: 'Client non trouvé' });
		}
		
		const hostResult = await pool.query(
			'SELECT name FROM hosts WHERE id = $1',
			[hostId]
		);
		
		const clientName = clientResult.rows[0].name;
		const clientEmail = clientResult.rows[0].email;
		const hostName = hostResult.rows[0]?.name || 'Votre hôte';
		
		// Créer la connexion
		await pool.query(
			'INSERT INTO connexions (host_id, client_id) VALUES ($1, $2)',
			[hostId, clientId]
		);
		
		console.log(`[BACKEND] Client connecté - ID: ${clientId}, Nom: ${clientName}, Hôte: ${hostName}`);
		
		// Renvoyer l'email de bienvenue avec le lien
		await sendWelcomeEmail(clientId, clientName, clientEmail, hostName);
		
		res.status(201).json({ success: true });
	} catch (error) {
		console.error('Erreur:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// Supprimer un client (uniquement la connexion)
app.delete('/api/host/:hostId/clients/:clientRef', authenticateHost, async (req, res) => {
	const { hostId, clientRef } = req.params;
	
	try {
		// Décoder la référence
		const clientId = Buffer.from(clientRef, 'base64').toString('utf-8');
		
		await pool.query(
			'DELETE FROM connexions WHERE host_id = $1 AND client_id = $2',
			[hostId, clientId]
		);
		res.json({ success: true });
	} catch (error) {
		console.error('Erreur:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// Récupérer les meetings et résultats d'un hôte
app.get('/api/host/:hostId/meetings', authenticateHost, async (req, res) => {
	const { hostId } = req.params;
	
	try {
		const meetingsResult = await pool.query(
			'SELECT * FROM meetings WHERE host_id = $1 ORDER BY start',
			[hostId]
		);
		
		const resultsResult = await pool.query(`
			SELECT r.* FROM results r
			INNER JOIN meetings m ON r.meeting_id = m.id
			WHERE m.host_id = $1
		`, [hostId]);
		
		res.json({
			meetings: meetingsResult.rows,
			results: resultsResult.rows
		});
	} catch (error) {
		console.error('Erreur:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// Créer un nouveau meeting
app.post('/api/host/:hostId/meetings', authenticateHost, async (req, res) => {
	const { hostId } = req.params;
	const { start, duration } = req.body;
	
	try {
		const result = await pool.query(
			'INSERT INTO meetings (host_id, start, duration) VALUES ($1, $2, $3) RETURNING id',
			[hostId, start, duration]
		);
		
		// Recalculer le planning
		await recalculatePlanning(hostId);
		
		res.status(201).json({ meetingId: result.rows[0].id });
	} catch (error) {
		console.error('Erreur:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// Supprimer un meeting
app.delete('/api/host/:hostId/meetings/:meetingId', authenticateHost, async (req, res) => {
	const { meetingId } = req.params;
	
	try {
		await pool.query('DELETE FROM meetings WHERE id = $1', [meetingId]);
		res.json({ success: true });
	} catch (error) {
		console.error('Erreur:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// Fixer un rendez-vous
app.post('/api/host/:hostId/fix-meeting', authenticateHost, async (req, res) => {
	const { hostId } = req.params;
	const { meetingId, clientId } = req.body;
	
	const client = await pool.connect();
	
	try {
		await client.query('BEGIN');
		
		// Vérifier si le result existe déjà
		const existingResult = await client.query(
			'SELECT id FROM results WHERE meeting_id = $1 AND client_id = $2',
			[meetingId, clientId]
		);
		
		if (existingResult.rows.length > 0) {
			// Mettre à jour
			await client.query(
				'UPDATE results SET fixed = true WHERE meeting_id = $1 AND client_id = $2',
				[meetingId, clientId]
			);
		} else {
			// Créer
			await client.query(
				'INSERT INTO results (meeting_id, client_id, fixed) VALUES ($1, $2, true)',
				[meetingId, clientId]
			);
		}
		
		await client.query('COMMIT');
		
		// Envoyer l'email
		await sendFixedMeetingEmail(meetingId, clientId);
		
		// Recalculer le planning
		await recalculatePlanning(hostId);
		
		res.json({ success: true, message: 'Email envoyé au client' });
	} catch (error) {
		await client.query('ROLLBACK');
		console.error('Erreur:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	} finally {
		client.release();
	}
});

// Défixer un rendez-vous
app.post('/api/host/:hostId/unfix-meeting', authenticateHost, async (req, res) => {
	const { hostId } = req.params;
	const { meetingId } = req.body;
	
	try {
		await pool.query(
			'UPDATE results SET fixed = false WHERE meeting_id = $1',
			[meetingId]
		);
		
		// Recalculer le planning
		await recalculatePlanning(hostId);
		
		res.json({ success: true });
	} catch (error) {
		console.error('Erreur:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// Recalculer le planning
app.post('/api/host/:hostId/recalculate', authenticateHost, async (req, res) => {
	const { hostId } = req.params;
	
	try {
		await recalculatePlanning(hostId);
		res.json({ success: true });
	} catch (error) {
		console.error('Erreur:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// ==================== ROUTES CLIENT ====================

// Récupérer infos client
app.get('/api/client/:clientId', async (req, res) => {
	const { clientId } = req.params;
	
	try {
		const result = await pool.query(
			'SELECT id, name, email FROM clients WHERE id = $1',
			[clientId]
		);
		
		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Client non trouvé' });
		}
		
		res.json(result.rows[0]);
	} catch (error) {
		console.error('Erreur:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// Récupérer les hôtes d'un client
app.get('/api/client/:clientId/hosts', async (req, res) => {
	const { clientId } = req.params;
	
	try {
		const result = await pool.query(`
			SELECT h.id, h.name, h.email 
			FROM hosts h
			INNER JOIN connexions cn ON h.id = cn.host_id
			WHERE cn.client_id = $1
			ORDER BY h.name
		`, [clientId]);
		
		res.json(result.rows);
	} catch (error) {
		console.error('Erreur:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// Récupérer les meetings d'un hôte pour un client
app.get('/api/client/:clientId/host/:hostId/meetings', async (req, res) => {
	const { clientId, hostId } = req.params;
	
	try {
		const meetingsResult = await pool.query(
			'SELECT * FROM meetings WHERE host_id = $1 ORDER BY start',
			[hostId]
		);
		
		const resultsResult = await pool.query(`
			SELECT * FROM results r
			INNER JOIN meetings m ON r.meeting_id = m.id
			WHERE m.host_id = $1
		`, [hostId]);
		
		const availabilitiesResult = await pool.query(`
			SELECT d.meeting_id, d.cost 
			FROM disponibilities d
			INNER JOIN meetings m ON d.meeting_id = m.id
			WHERE m.host_id = $1 AND d.client_id = $2
		`, [hostId, clientId]);
		
		res.json({
			meetings: meetingsResult.rows,
			results: resultsResult.rows,
			availabilities: availabilitiesResult.rows
		});
	} catch (error) {
		console.error('Erreur:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// Enregistrer les disponibilités d'un client
app.post('/api/client/:clientId/availabilities', async (req, res) => {
	const { clientId } = req.params;
	const { hostId, requestedHours, availabilities } = req.body;
	
	const client = await pool.connect();
	
	try {
		await client.query('BEGIN');
		
		// Supprimer les anciennes disponibilités
		await client.query(`
			DELETE FROM disponibilities 
			WHERE client_id = $1 
			AND meeting_id IN (
				SELECT id FROM meetings WHERE host_id = $2
			)
		`, [clientId, hostId]);
		
		// Insérer les nouvelles disponibilités
		for (const avail of availabilities) {
			await client.query(
				'INSERT INTO disponibilities (meeting_id, client_id, cost) VALUES ($1, $2, $3)',
				[avail.meetingId, clientId, avail.cost]
			);
		}
		
		await client.query('COMMIT');
		
		// Recalculer le planning
		await recalculatePlanning(hostId);
		
		res.json({ success: true });
	} catch (error) {
		await client.query('ROLLBACK');
		console.error('Erreur:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	} finally {
		client.release();
	}
});

// ==================== FONCTIONS UTILITAIRES ====================

// Générer un ID client unique
async function generateUniqueClientId(client) {
	let attempts = 0;
	const maxAttempts = 10;
	
	while (attempts < maxAttempts) {
		// Générer un ID aléatoire (format: CLIENT + 6 chiffres)
		const randomNum = Math.floor(100000 + Math.random() * 900000);
		const clientId = `CLIENT${randomNum}`;
		
		// Vérifier s'il existe déjà
		const existing = await client.query(
			'SELECT id FROM clients WHERE id = $1',
			[clientId]
		);
		
		if (existing.rows.length === 0) {
			return clientId;
		}
		
		attempts++;
	}
	
	// Fallback avec timestamp si échec
	return `CLIENT${Date.now()}`;
}

// Envoyer un email de bienvenue avec lien d'accès
async function sendWelcomeEmail(clientId, clientName, clientEmail, hostName) {
	try {
		const accessLink = `${process.env.URL || 'http://localhost:3000'}/clienthome.html?id=${clientId}`;
		
		await transporter.sendMail({
			from: process.env.SMTP_FROM || 'noreply@rdv-manager.com',
			to: clientEmail,
			subject: 'Bienvenue - Accédez à vos rendez-vous',
			html: `
				<h1>Bienvenue sur votre espace rendez-vous</h1>
				<p>Bonjour ${clientName},</p>
				<p><strong>${hostName}</strong> vous a ajouté(e) à son système de gestion de rendez-vous.</p>
				
				<p>Pour accéder à votre espace et indiquer vos disponibilités, cliquez sur le lien ci-dessous :</p>
				
				<p style="margin: 2rem 0;">
					<a href="${accessLink}" style="background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block;">
						Accéder à mon espace
					</a>
				</p>
				
				<p style="color: #6B7280; font-size: 0.875rem;">
					Ou copiez ce lien dans votre navigateur :<br>
					<a href="${accessLink}">${accessLink}</a>
				</p>
				
				<p style="margin-top: 2rem; color: #6B7280; font-size: 0.875rem;">
					Conservez précieusement ce lien, il vous permettra d'accéder à vos rendez-vous à tout moment.
				</p>
			`
		});
		
		console.log(`[EMAIL] Email envoyé à ${clientEmail} avec lien: ${accessLink}`);
	} catch (error) {
		console.error('Erreur envoi email bienvenue:', error);
	}
}

// Envoyer un email de confirmation de RDV
async function sendFixedMeetingEmail(meetingId, clientId) {
	try {
		const result = await pool.query(`
			SELECT 
				c.name as client_name,
				c.email as client_email,
				m.start,
				m.duration,
				h.name as host_name
			FROM meetings m
			INNER JOIN hosts h ON m.host_id = h.id
			CROSS JOIN clients c
			WHERE m.id = $1 AND c.id = $2
		`, [meetingId, clientId]);
		
		if (result.rows.length === 0) return;
		
		const { client_name, client_email, start, duration, host_name } = result.rows[0];
		const date = new Date(start);
		
		await transporter.sendMail({
			from: process.env.SMTP_FROM || 'noreply@rdv-manager.com',
			to: client_email,
			subject: 'Votre rendez-vous a été confirmé',
			html: `
				<h1>Rendez-vous confirmé</h1>
				<p>Bonjour ${client_name},</p>
				<p>Votre rendez-vous avec <strong>${host_name}</strong> a été fixé :</p>
				<ul>
					<li><strong>Date :</strong> ${date.toLocaleDateString('fr-FR', { 
						weekday: 'long', 
						year: 'numeric', 
						month: 'long', 
						day: 'numeric' 
					})}</li>
					<li><strong>Heure :</strong> ${date.toLocaleTimeString('fr-FR', { 
						hour: '2-digit', 
						minute: '2-digit' 
					})}</li>
					<li><strong>Durée :</strong> ${duration} heure(s)</li>
				</ul>
				<p>À bientôt !</p>
			`
		});
	} catch (error) {
		console.error('Erreur envoi email:', error);
	}
}

// Recalculer le planning avec planify()
async function recalculatePlanning(hostId) {
	const client = await pool.connect();
	
	try {
		// Récupérer tous les meetings
		const meetingsResult = await client.query(
			'SELECT * FROM meetings WHERE host_id = $1',
			[hostId]
		);
		const meetings = meetingsResult.rows;
		
		// Récupérer les résultats fixés
		const fixedResult = await client.query(`
			SELECT r.* FROM results r
			INNER JOIN meetings m ON r.meeting_id = m.id
			WHERE m.host_id = $1 AND r.fixed = true
		`, [hostId]);
		const fixedResults = fixedResult.rows;
		
		// Récupérer tous les clients avec leurs disponibilités
		const clientsResult = await client.query(`
			SELECT DISTINCT 
				c.id as user_id,
				d.meeting_id,
				d.cost
			FROM clients c
			INNER JOIN connexions cn ON c.id = cn.client_id
			INNER JOIN disponibilities d ON c.id = d.client_id
			INNER JOIN meetings m ON d.meeting_id = m.id
			WHERE cn.host_id = $1
		`, [hostId]);
		
		// Organiser les données pour planify
		const usersMap = new Map();
		
		for (const row of clientsResult.rows) {
			if (!usersMap.has(row.user_id)) {
				usersMap.set(row.user_id, {
					userId: row.user_id,
					requestedHours: 1, // À améliorer : stocker dans la DB
					disponibilities: []
				});
			}
			
			usersMap.get(row.user_id).disponibilities.push({
				meetingId: row.meeting_id,
				cost: row.cost
			});
		}
		
		const users = Array.from(usersMap.values());
		
		// Appeler planify
		const newResults = planify(meetings, fixedResults, users);
		
		// Supprimer les anciens résultats non fixés
		await client.query(`
			DELETE FROM results 
			WHERE meeting_id IN (
				SELECT id FROM meetings WHERE host_id = $1
			) AND fixed = false
		`, [hostId]);
		
		// Insérer les nouveaux résultats
		for (const result of newResults) {
			await client.query(
				'INSERT INTO results (meeting_id, client_id, fixed) VALUES ($1, $2, false) ON CONFLICT DO NOTHING',
				[result.meeting_id, result.client_id]
			);
		}
		
	} catch (error) {
		console.error('Erreur recalcul:', error);
		throw error;
	} finally {
		client.release();
	}
}



function evalDistributionScore(arr, alpha=2, beta=1) {
	if (!arr.length) return 0;

	const mean = arr.reduce((sum, x) => sum + x, 0) / arr.length;
    const epsilon = 1e-8; // pour éviter division par zéro
    const score = 1 / mean;
    return score;
}

/**
 * Génère toutes les combinaisons {meeting, user} possibles
 * en respectant requestedHours et en ignorant les meetings fixés.
 *
 * @param {Array} users - Liste des utilisateurs [{id, requestedHours, disponibilities: [{meetingId, cost}]}]
 * @param {Array} fixedResults
 * @param {Array} meetings - Liste des meetings [{id}]
 */
function planify(meetings, fixedResults, users) {
	const fixedMeetingIds = new Set(fixedResults.map(r => r.meeting_id));
	const userCount = new Map();
	users.forEach(u => userCount.set(u.id, 0));

	let bestScore = Infinity;
	let bestComb = [];

	const availableMeetings = meetings.filter(m => !fixedMeetingIds.has(m.id));

	function evalScore(cmb) {
		const list = new Array(users.length);
		const presenceCount = new Int32Array(users.length);
		for (let u = 0; u < users.length; u++) { 
			list[u] = users[u].score;
			presenceCount[i] = users[u].requestedHours;
		}
		
		for (let c of cmb) {
			const m = c.meeting;
			let val = Infinity;
			for (let d of c.user.disponibilities) {
				if (d.meeting === m) {
					val = d.cost;
					presenceCount[c.u]--;
					break;
				}
			}
			
			list[c.u] += val;
		};

		for (let u = 0; u < users.length; u++) { 
			list[c.u] += presenceCount[c.u] * users[u].missing_cost;
		}


		return evalDistributionScore(list);
	}

	function backtrack(idx, currentCombinations) {
		if (idx === availableMeetings.length) {
			const score = evalScore(currentCombinations);
			if (score > bestScore) {
				bestScore = score;
				bestComb = currentCombinations.map(c => ({
					meeting_id: c.meeting.id,
					client_id: c.user.id
				}))
			}

			return;
		}

		const meeting = availableMeetings[idx];

		// Pour chaque user disponible
		for (let u = 0; u < users.length; u++) {
			const user = users[u];
			const isAvailable = user.disponibilities.some(d => d.meetingId === meeting.id);
			const count = userCount.get(user.id);

			if (isAvailable && count < user.requestedHours) {
				userCount.set(user.id, count + 1);
				currentCombinations.push({ meeting, user, u });

				backtrack(idx + 1, currentCombinations);

				currentCombinations.pop();
				userCount.set(user.id, count);
			}
		}

		// Optionnel : possibilité de laisser le meeting non assigné
		backtrack(idx + 1, currentCombinations);
	}

	backtrack(0, []);
}


// ==================== DÉMARRAGE SERVEUR ====================

app.listen(PORT, () => {
	console.log(`🚀 Serveur démarré sur le port ${PORT}`);
	console.log(`📝 Frontend accessible sur http://localhost:${PORT}`);
});