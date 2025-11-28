const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const path = require('path');
const { getNewScore } = require('./public/planify.js');
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

// ==================== TÂCHES PLANIFIÉES ====================

// Décroissance des scores hebdomadaire
setInterval(async () => {
	try {
		await pool.query(`
			UPDATE clients 
			SET score = score / 2.5,
			    last_score_decay = CURRENT_TIMESTAMP
			WHERE last_score_decay < CURRENT_TIMESTAMP - INTERVAL '7 days'
		`);
		console.log('✅ Décroissance des scores effectuée');
	} catch (error) {
		console.error('❌ Erreur décroissance scores:', error);
	}
}, 24 * 60 * 60 * 1000); // Vérifier toutes les 24h

// ==================== ROUTES AUTHENTIFICATION ====================

// Inscription hôte
app.post('/api/host/register', async (req, res) => {
	const { name, email, password } = req.body;
	
	try {
		const existingHost = await pool.query(
			'SELECT id FROM hosts WHERE email = $1',
			[email]
		);
		
		if (existingHost.rows.length > 0) {
			return res.status(400).json({ message: 'Cet email est déjà utilisé' });
		}
		
		const hashedPassword = await bcrypt.hash(password, 10);
		
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

// Rechercher des clients
app.get('/api/clients/search', authenticateHost, async (req, res) => {
	const { q } = req.query;
	
	if (!q || q.length < 2) {
		return res.json([]);
	}
	
	try {
		const result = await pool.query(`
			SELECT id, name, email, score, missing_cost
			FROM clients 
			WHERE LOWER(name) LIKE LOWER($1) OR LOWER(email) LIKE LOWER($1)
			LIMIT 10
		`, [`%${q}%`]);
		
		const clients = result.rows.map(client => ({
			ref: Buffer.from(client.id).toString('base64'),
			name: client.name,
			email: client.email,
			score: client.score,
			missing_cost: client.missing_cost
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
			SELECT c.id, c.name, c.email, c.score, c.missing_cost
			FROM clients c
			INNER JOIN connexions cn ON c.id = cn.client_id
			WHERE cn.host_id = $1
			ORDER BY c.name
		`, [hostId]);
		
		const clients = result.rows.map(client => ({
			id: client.id,
			ref: Buffer.from(client.id).toString('base64'),
			name: client.name,
			email: client.email,
			score: client.score,
			missing_cost: client.missing_cost
		}));
		
		res.json(clients);
	} catch (error) {
		console.error('Erreur:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// Mettre à jour missing_cost d'un client
app.patch('/api/host/:hostId/clients/:clientId/missing-cost', authenticateHost, async (req, res) => {
	const { clientId } = req.params;
	const { missing_cost } = req.body;
	
	try {
		await pool.query(
			'UPDATE clients SET missing_cost = $1 WHERE id = $2',
			[missing_cost, clientId]
		);
		res.json({ success: true });
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
		
		const existingClient = await client.query(
			'SELECT id FROM clients WHERE email = $1',
			[email]
		);
		
		if (existingClient.rows.length > 0) {
			await client.query('ROLLBACK');
			return res.status(400).json({ message: 'Un client avec cet email existe déjà' });
		}
		
		const clientId = await generateUniqueClientId(client);
		
		console.log(`[BACKEND] Nouveau client créé - ID: ${clientId}, Nom: ${name}, Email: ${email}`);
		
		await client.query(
			'INSERT INTO clients (id, name, email, score, missing_cost) VALUES ($1, $2, $3, 0, 150)',
			[clientId, name, email]
		);
		
		await client.query(
			'INSERT INTO connexions (host_id, client_id) VALUES ($1, $2)',
			[hostId, clientId]
		);
		
		await client.query('COMMIT');
		
		const hostResult = await pool.query(
			'SELECT name FROM hosts WHERE id = $1',
			[hostId]
		);
		const hostName = hostResult.rows[0]?.name || 'Votre hôte';
		
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

// Connecter un client existant
app.post('/api/host/:hostId/clients/connect', authenticateHost, async (req, res) => {
	const { hostId } = req.params;
	const { clientRef } = req.body;
	
	try {
		const clientId = Buffer.from(clientRef, 'base64').toString('utf-8');
		
		const existingConnection = await pool.query(
			'SELECT id FROM connexions WHERE host_id = $1 AND client_id = $2',
			[hostId, clientId]
		);
		
		if (existingConnection.rows.length > 0) {
			return res.status(400).json({ message: 'Ce client est déjà associé à votre compte' });
		}
		
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
		
		await pool.query(
			'INSERT INTO connexions (host_id, client_id) VALUES ($1, $2)',
			[hostId, clientId]
		);
		
		console.log(`[BACKEND] Client connecté - ID: ${clientId}, Nom: ${clientName}, Hôte: ${hostName}`);
		
		await sendWelcomeEmail(clientId, clientName, clientEmail, hostName);
		
		res.status(201).json({ success: true });
	} catch (error) {
		console.error('Erreur:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// Supprimer un client
app.delete('/api/host/:hostId/clients/:clientRef', authenticateHost, async (req, res) => {
	const { hostId, clientRef } = req.params;
	
	try {
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

// Récupérer les meetings et résultats
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

// Créer un meeting
app.post('/api/host/:hostId/meetings', authenticateHost, async (req, res) => {
	const { hostId } = req.params;
	const { start, duration } = req.body;
	
	try {
		const result = await pool.query(
			'INSERT INTO meetings (host_id, start, duration) VALUES ($1, $2, $3) RETURNING id',
			[hostId, start, duration]
		);
		
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
		
		// Récupérer les infos nécessaires pour calculer le nouveau score
		const meetingsResult = await client.query(
			'SELECT * FROM meetings WHERE host_id = $1',
			[hostId]
		);
		
		const fixedResults = await client.query(`
			SELECT r.* FROM results r
			INNER JOIN meetings m ON r.meeting_id = m.id
			WHERE m.host_id = $1 AND r.fixed = true
		`, [hostId]);
		
		const clientsData = await client.query(`
			SELECT c.id as user_id, c.score, c.missing_cost,
			       d.meeting_id, d.cost
			FROM clients c
			INNER JOIN connexions cn ON c.id = cn.client_id
			LEFT JOIN disponibilities d ON c.id = d.client_id
			WHERE cn.host_id = $1
		`, [hostId]);
		
		// Organiser les données pour getNewScore
		const usersMap = new Map();
		clientsData.rows.forEach(row => {
			if (!usersMap.has(row.user_id)) {
				usersMap.set(row.user_id, {
					userId: row.user_id,
					score: row.score || 0,
					missing_cost: row.missing_cost || 150,
					requestedHours: 1,
					disponibilities: []
				});
			}
			if (row.meeting_id) {
				usersMap.get(row.user_id).disponibilities.push({
					meetingId: row.meeting_id,
					cost: row.cost
				});
			}
		});
		
		const users = Array.from(usersMap.values());
		const userIdx = users.findIndex(u => u.userId === clientId);
		
		// Mettre à jour ou créer le résultat
		const existingResult = await client.query(
			'SELECT id FROM results WHERE meeting_id = $1 AND client_id = $2',
			[meetingId, clientId]
		);
		
		if (existingResult.rows.length > 0) {
			await client.query(
				'UPDATE results SET fixed = true WHERE meeting_id = $1 AND client_id = $2',
				[meetingId, clientId]
			);
		} else {
			await client.query(
				'INSERT INTO results (meeting_id, client_id, fixed) VALUES ($1, $2, true)',
				[meetingId, clientId]
			);
		}
		
		// Calculer et mettre à jour le score
		if (userIdx !== -1) {
			const newFixedResults = [...fixedResults.rows, { meeting_id: meetingId, client_id: clientId }];
			const newScore = getNewScore(meetingsResult.rows, newFixedResults, users, userIdx);
			
			await client.query(
				'UPDATE clients SET score = $1 WHERE id = $2',
				[newScore, clientId]
			);
		}
		
		await client.query('COMMIT');
		
		await sendFixedMeetingEmail(meetingId, clientId);
		
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
			'DELETE FROM results WHERE meeting_id = $1 AND fixed = true',
			[meetingId]
		);
		
		res.json({ success: true });
	} catch (error) {
		console.error('Erreur:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// Simuler le planning (sans sauvegarder)
app.post('/api/host/:hostId/simulate', authenticateHost, async (req, res) => {
	const { hostId } = req.params;
	const { results } = req.body; // Nouveaux résultats proposés
	
	try {
		res.json({ success: true, simulatedResults: results });
	} catch (error) {
		console.error('Erreur:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// Envoyer les résultats du planning
app.post('/api/host/:hostId/send-planning', authenticateHost, async (req, res) => {
	const { hostId } = req.params;
	const { results } = req.body;
	
	const client = await pool.connect();
	
	try {
		await client.query('BEGIN');
		
		// Supprimer les anciens résultats non fixés
		await client.query(`
			DELETE FROM results 
			WHERE meeting_id IN (
				SELECT id FROM meetings WHERE host_id = $1
			) AND fixed = false
		`, [hostId]);
		
		// Insérer les nouveaux résultats
		for (const result of results) {
			await client.query(
				'INSERT INTO results (meeting_id, client_id, fixed) VALUES ($1, $2, false) ON CONFLICT DO NOTHING',
				[result.meeting_id, result.client_id]
			);
		}
		
		await client.query('COMMIT');
		
		res.json({ success: true });
	} catch (error) {
		await client.query('ROLLBACK');
		console.error('Erreur:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	} finally {
		client.release();
	}
});

// ==================== ROUTES CLIENT ====================

// Récupérer infos client
app.get('/api/client/:clientId', async (req, res) => {
	const { clientId } = req.params;
	
	try {
		const result = await pool.query(
			'SELECT id, name, email, score FROM clients WHERE id = $1',
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

// Récupérer les meetings pour un client
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
		
		const clientsData = await pool.query(`
			SELECT c.id, c.score, c.missing_cost
			FROM clients c
			INNER JOIN connexions cn ON c.id = cn.client_id
			WHERE cn.host_id = $1
		`, [hostId]);
		
		res.json({
			meetings: meetingsResult.rows,
			results: resultsResult.rows,
			availabilities: availabilitiesResult.rows,
			clients: clientsData.rows
		});
	} catch (error) {
		console.error('Erreur:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// Enregistrer les disponibilités
app.post('/api/client/:clientId/availabilities', async (req, res) => {
	const { clientId } = req.params;
	const { hostId, requestedHours, availabilities } = req.body;
	
	const client = await pool.connect();
	
	try {
		await client.query('BEGIN');
		
		await client.query(`
			DELETE FROM disponibilities 
			WHERE client_id = $1 
			AND meeting_id IN (
				SELECT id FROM meetings WHERE host_id = $2
			)
		`, [clientId, hostId]);
		
		for (const avail of availabilities) {
			await client.query(
				'INSERT INTO disponibilities (meeting_id, client_id, cost) VALUES ($1, $2, $3)',
				[avail.meetingId, clientId, avail.cost]
			);
		}
		
		await client.query('COMMIT');
		
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

async function generateUniqueClientId(client) {
	let attempts = 0;
	const maxAttempts = 10;
	
	while (attempts < maxAttempts) {
		// ID plus long : CLIENT + 10 caractères alphanumériques
		const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
		let randomStr = '';
		for (let i = 0; i < 10; i++) {
			randomStr += chars.charAt(Math.floor(Math.random() * chars.length));
		}
		const clientId = `CLIENT${randomStr}`;
		
		const existing = await client.query(
			'SELECT id FROM clients WHERE id = $1',
			[clientId]
		);
		
		if (existing.rows.length === 0) {
			return clientId;
		}
		
		attempts++;
	}
	
	return `CLIENT${Date.now()}`;
}

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

app.listen(PORT, () => {
	console.log(`🚀 Serveur démarré sur le port ${PORT}`);
	console.log(`📁 Frontend accessible sur http://localhost:${PORT}`);
});