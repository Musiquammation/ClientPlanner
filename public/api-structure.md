# Structure de l'API Backend

Ce document décrit les endpoints nécessaires pour votre backend Node.js + PostgreSQL.

## Configuration Base de données

```sql
-- HOSTS
CREATE TABLE hosts (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- CLIENTS
CREATE TABLE clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- CONNEXION (relation host-client)
CREATE TABLE connexions (
    id SERIAL PRIMARY KEY,
    host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
    client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(host_id, client_id)
);

-- MEETINGS (créneaux horaires)
CREATE TABLE meetings (
    id SERIAL PRIMARY KEY,
    host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
    start TIMESTAMP NOT NULL,
    duration FLOAT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- RESULTS (résultats de planification)
CREATE TABLE results (
    id SERIAL PRIMARY KEY,
    meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
    client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
    fixed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(meeting_id, client_id)
);

-- DISPONIBILITIES (disponibilités des clients)
CREATE TABLE disponibilities (
    id SERIAL PRIMARY KEY,
    meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
    client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
    cost FLOAT NOT NULL CHECK (cost >= 0 AND cost <= 100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(meeting_id, client_id)
);

-- Index pour performances
CREATE INDEX idx_meetings_host ON meetings(host_id);
CREATE INDEX idx_results_meeting ON results(meeting_id);
CREATE INDEX idx_results_client ON results(client_id);
CREATE INDEX idx_disponibilities_meeting ON disponibilities(meeting_id);
CREATE INDEX idx_disponibilities_client ON disponibilities(client_id);
```

## Endpoints API

### Authentification Hôte

#### POST `/api/host/register`
Créer un nouveau compte hôte.
```json
Request:
{
    "name": "John Doe",
    "email": "john@example.com",
    "password": "securepassword"
}

Response:
{
    "hostId": 1,
    "message": "Compte créé avec succès"
}
```

#### POST `/api/host/login`
Connexion hôte.
```json
Request:
{
    "email": "john@example.com",
    "password": "securepassword"
}

Response:
{
    "token": "jwt-token-here",
    "hostId": 1
}
```

### Gestion des Hôtes

#### GET `/api/host/:hostId`
Récupérer les infos d'un hôte.
```json
Response:
{
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com"
}
```

#### GET `/api/host/:hostId/clients`
Récupérer tous les clients d'un hôte.
```json
Response: [
    {
        "id": "CLIENT123",
        "name": "Alice Martin",
        "email": "alice@example.com"
    }
]
```

#### GET `/api/host/:hostId/meetings`
Récupérer tous les meetings avec leurs résultats.
```json
Response:
{
    "meetings": [
        {
            "id": 1,
            "host_id": 1,
            "start": "2024-01-15T10:00:00Z",
            "duration": 1
        }
    ],
    "results": [
        {
            "id": 1,
            "meeting_id": 1,
            "client_id": "CLIENT123",
            "fixed": false
        }
    ]
}
```

### Gestion des Meetings (Hôte)

#### POST `/api/host/:hostId/meetings`
Créer un nouveau créneau.
```json
Request:
{
    "start": "2024-01-15T10:00:00Z",
    "duration": 1
}

Response:
{
    "meetingId": 1
}
```

#### DELETE `/api/host/:hostId/meetings/:meetingId`
Supprimer un créneau.

#### POST `/api/host/:hostId/fix-meeting`
Fixer un rendez-vous.
```json
Request:
{
    "meetingId": 1,
    "clientId": "CLIENT123"
}

Response:
{
    "success": true,
    "message": "Email envoyé au client"
}
```

**Action:** 
- Mettre `fixed = true` dans la table `results`
- Envoyer un email au client
- Appeler la fonction `planify()` pour recalculer

#### POST `/api/host/:hostId/unfix-meeting`
Défixer un rendez-vous.
```json
Request:
{
    "meetingId": 1
}
```

**Action:** 
- Mettre `fixed = false` ou supprimer la ligne dans `results`
- Appeler `planify()` pour recalculer

#### POST `/api/host/:hostId/recalculate`
Recalculer le planning.

**Action:** Appeler la fonction `planify(meetings, fixedResults, users)`

### Gestion des Clients

#### GET `/api/client/:clientId`
Récupérer les infos d'un client.
```json
Response:
{
    "id": "CLIENT123",
    "name": "Alice Martin",
    "email": "alice@example.com"
}
```

#### GET `/api/client/:clientId/hosts`
Récupérer tous les hôtes d'un client.
```json
Response: [
    {
        "id": 1,
        "name": "John Doe",
        "email": "john@example.com"
    }
]
```

#### GET `/api/client/:clientId/host/:hostId/meetings`
Récupérer les meetings d'un hôte avec les disponibilités du client.
```json
Response:
{
    "meetings": [
        {
            "id": 1,
            "host_id": 1,
            "start": "2024-01-15T10:00:00Z",
            "duration": 1
        }
    ],
    "results": [
        {
            "id": 1,
            "meeting_id": 1,
            "client_id": "CLIENT123",
            "fixed": false
        }
    ],
    "availabilities": [
        {
            "meeting_id": 1,
            "client_id": "CLIENT123",
            "cost": 25
        }
    ]
}
```

#### POST `/api/client/:clientId/availabilities`
Enregistrer les disponibilités d'un client.
```json
Request:
{
    "hostId": 1,
    "requestedHours": 2,
    "availabilities": [
        {
            "meetingId": 1,
            "cost": 25
        },
        {
            "meetingId": 2,
            "cost": 75
        }
    ]
}

Response:
{
    "success": true
}
```

**Action:**
- Supprimer les anciennes disponibilités du client pour cet hôte
- Insérer les nouvelles dans la table `disponibilities`
- Appeler `planify()` pour recalculer le planning

## Fonction planify()

Voici un exemple de signature simplifié (à implémenter par vous) :

```javascript
/**
 * Fonction de planification intelligente
 * 
 * @param {Array} meetings - Liste des créneaux disponibles
 * @param {Array} fixedResults - Résultats déjà fixés (ne pas toucher)
 * @param {Array} users - Liste des utilisateurs avec leurs disponibilités
 * 
 * users = [
 *   {
 *     userId: "CLIENT123",
 *     requestedHours: 2,
 *     disponibilities: [
 *       { meetingId: 1, cost: 25 },
 *       { meetingId: 2, cost: 75 }
 *     ]
 *   }
 * ]
 * 
 * @returns {Array} - Nouveaux résultats à insérer dans la table results
 */
async function planify(meetings, fixedResults, users) {
    // Votre algorithme de planification ici
    // - Respecter les RDV déjà fixés
    // - Optimiser selon les coûts (préférences)
    // - Respecter le nombre d'heures demandées
    
    return newResults; // [{meeting_id, client_id, fixed: false}]
}
```

## Envoi d'emails

Quand un RDV est fixé, envoyer un email au client :

```javascript
// Exemple avec nodemailer
const nodemailer = require('nodemailer');

async function sendFixedMeetingEmail(client, meeting) {
    const transporter = nodemailer.createTransport({
        // Configuration SMTP
    });

    await transporter.sendMail({
        from: 'noreply@votresite.com',
        to: client.email,
        subject: 'Votre rendez-vous a été confirmé',
        html: `
            <h1>Rendez-vous confirmé</h1>
            <p>Bonjour ${client.name},</p>
            <p>Votre rendez-vous a été fixé pour le ${new Date(meeting.start).toLocaleString('fr-FR')}.</p>
        `
    });
}
```

## Exemple de Stack Technique

```javascript
// server.js
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// Middleware
app.use(express.json());
app.use(express.static('public')); // Pour servir les fichiers HTML/CSS/JS

// Routes...

app.listen(3000, () => {
    console.log('Server running on port 3000');
});
```

## Notes importantes

1. **Sécurité** : Utilisez bcrypt pour hasher les mots de passe, JWT pour les tokens
2. **Validation** : Validez toutes les entrées utilisateur
3. **Transactions** : Utilisez des transactions SQL pour les opérations critiques
4. **Rate limiting** : Limitez les appels à `planify()` pour éviter la surcharge
5. **Websockets** : Envisagez Socket.io pour les mises à jour en temps réel
