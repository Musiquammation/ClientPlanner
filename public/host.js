const API_URL = '/api';
let currentMeetings = [];
let currentResults = [];
let currentClients = [];
let selectedMeetingId = null;

// Vérifier l'authentification
const hostToken = localStorage.getItem('hostToken');
const hostId = localStorage.getItem('hostId');

if (!hostToken || !hostId) {
    window.location.href = '/index.html';
}

// Headers avec auth
const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${hostToken}`
};

// Charger les données initiales
async function loadData() {
    try {
        const [hostRes, meetingsRes, clientsRes] = await Promise.all([
            fetch(`${API_URL}/host/${hostId}`, { headers: authHeaders }),
            fetch(`${API_URL}/host/${hostId}/meetings`, { headers: authHeaders }),
            fetch(`${API_URL}/host/${hostId}/clients`, { headers: authHeaders })
        ]);

        if (hostRes.ok) {
            const host = await hostRes.json();
            document.getElementById('hostName').textContent = host.name;
        }

        if (meetingsRes.ok) {
            const data = await meetingsRes.json();
            currentMeetings = data.meetings;
            currentResults = data.results;
            renderPlanner();
        }

        if (clientsRes.ok) {
            currentClients = await clientsRes.json();
            updateStats();
        }
    } catch (error) {
        console.error('Erreur de chargement:', error);
    }
}

// Afficher le planning
function renderPlanner() {
    const grid = document.getElementById('plannerGrid');
    
    if (currentMeetings.length === 0) {
        grid.innerHTML = '<div class="loading">Aucun créneau disponible. Ajoutez-en un pour commencer.</div>';
        return;
    }

    // Trier les meetings par date
    const sortedMeetings = [...currentMeetings].sort((a, b) => 
        new Date(a.start) - new Date(b.start)
    );

    grid.innerHTML = sortedMeetings.map(meeting => {
        const result = currentResults.find(r => r.meeting_id === meeting.id);
        const isFixed = result?.fixed || false;
        const client = isFixed ? currentClients.find(c => c.id === result.client_id) : null;
        
        const date = new Date(meeting.start);
        const timeStr = date.toLocaleString('fr-FR', { 
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        });

        return `
            <div class="time-slot ${isFixed ? 'fixed' : ''} ${result && !isFixed ? 'reserved' : ''}" 
                 data-meeting-id="${meeting.id}">
                <div class="slot-time">${timeStr}</div>
                <div class="slot-status">
                    ${isFixed ? '✓ Fixé' : result ? 'Proposé' : 'Disponible'}
                </div>
                ${client ? `<div class="slot-client">${client.name}</div>` : ''}
                <div class="host-controls">
                    ${!isFixed ? `
                        <button class="btn btn-primary btn-small fix-btn" data-meeting-id="${meeting.id}">
                            Fixer
                        </button>
                    ` : `
                        <button class="btn btn-danger btn-small unfix-btn" data-meeting-id="${meeting.id}">
                            Défixer
                        </button>
                    `}
                    <button class="btn btn-danger btn-small delete-btn" data-meeting-id="${meeting.id}">
                        Supprimer
                    </button>
                </div>
            </div>
        `;
    }).join('');

    // Ajouter les événements
    document.querySelectorAll('.fix-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openFixModal(btn.dataset.meetingId);
        });
    });

    document.querySelectorAll('.unfix-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            unfixMeeting(btn.dataset.meetingId);
        });
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteMeeting(btn.dataset.meetingId);
        });
    });

    updateStats();
}

// Ouvrir la modal pour fixer un RDV
function openFixModal(meetingId) {
    selectedMeetingId = meetingId;
    const meeting = currentMeetings.find(m => m.id === parseInt(meetingId));
    
    if (!meeting) return;

    const date = new Date(meeting.start);
    const timeStr = date.toLocaleString('fr-FR', { 
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    document.getElementById('fixMeetingTime').textContent = timeStr;
    
    // Afficher les clients qui ont marqué ce créneau comme disponible
    const clientsForMeeting = currentResults
        .filter(r => r.meeting_id === parseInt(meetingId) && !r.fixed)
        .map(r => currentClients.find(c => c.id === r.client_id))
        .filter(c => c);

    const clientList = document.getElementById('clientList');
    
    if (clientsForMeeting.length === 0) {
        clientList.innerHTML = '<div class="loading">Aucun client n\'a indiqué ce créneau comme disponible</div>';
    } else {
        clientList.innerHTML = clientsForMeeting.map(client => `
            <div class="client-item" data-client-id="${client.id}">
                <div class="client-name">${client.name}</div>
                <div class="client-email">${client.email}</div>
            </div>
        `).join('');

        clientList.querySelectorAll('.client-item').forEach(item => {
            item.addEventListener('click', () => {
                fixMeeting(selectedMeetingId, item.dataset.clientId);
            });
        });
    }

    document.getElementById('fixMeetingModal').style.display = 'block';
}

// Fixer un rendez-vous
async function fixMeeting(meetingId, clientId) {
    try {
        const response = await fetch(`${API_URL}/host/${hostId}/fix-meeting`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ meetingId: parseInt(meetingId), clientId })
        });

        if (response.ok) {
            document.getElementById('fixMeetingModal').style.display = 'none';
            await loadData();
            alert('Rendez-vous fixé ! Un email a été envoyé au client.');
        } else {
            alert('Erreur lors de la fixation du rendez-vous');
        }
    } catch (error) {
        console.error('Erreur:', error);
        alert('Erreur de connexion au serveur');
    }
}

// Défixer un rendez-vous
async function unfixMeeting(meetingId) {
    if (!confirm('Voulez-vous vraiment défixer ce rendez-vous ?')) return;

    try {
        const response = await fetch(`${API_URL}/host/${hostId}/unfix-meeting`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ meetingId: parseInt(meetingId) })
        });

        if (response.ok) {
            await recalculate();
            alert('Rendez-vous défixé');
        } else {
            alert('Erreur lors de la défixation du rendez-vous');
        }
    } catch (error) {
        console.error('Erreur:', error);
        alert('Erreur de connexion au serveur');
    }
}

// Supprimer un créneau
async function deleteMeeting(meetingId) {
    if (!confirm('Voulez-vous vraiment supprimer ce créneau ?')) return;

    try {
        const response = await fetch(`${API_URL}/host/${hostId}/meetings/${meetingId}`, {
            method: 'DELETE',
            headers: authHeaders
        });

        if (response.ok) {
            await loadData();
        } else {
            alert('Erreur lors de la suppression');
        }
    } catch (error) {
        console.error('Erreur:', error);
        alert('Erreur de connexion au serveur');
    }
}

// Recalculer le planning
async function recalculate() {
    try {
        const response = await fetch(`${API_URL}/host/${hostId}/recalculate`, {
            method: 'POST',
            headers: authHeaders
        });

        if (response.ok) {
            await loadData();
        } else {
            alert('Erreur lors du recalcul');
        }
    } catch (error) {
        console.error('Erreur:', error);
    }
}

// Mettre à jour les stats
function updateStats() {
    document.getElementById('totalMeetings').textContent = currentMeetings.length;
    document.getElementById('fixedMeetings').textContent = 
        currentResults.filter(r => r.fixed).length;
    document.getElementById('totalClients').textContent = currentClients.length;
}

// Événements
document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('hostToken');
    localStorage.removeItem('hostId');
    window.location.href = '/index.html';
});

document.getElementById('refreshBtn').addEventListener('click', recalculate);

document.getElementById('addMeetingBtn').addEventListener('click', () => {
    document.getElementById('addMeetingModal').style.display = 'block';
});

document.getElementById('cancelAddBtn').addEventListener('click', () => {
    document.getElementById('addMeetingModal').style.display = 'none';
});

document.getElementById('cancelFixBtn').addEventListener('click', () => {
    document.getElementById('fixMeetingModal').style.display = 'none';
});

document.getElementById('addMeetingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const date = document.getElementById('meetingDate').value;
    const time = document.getElementById('meetingTime').value;
    const duration = parseFloat(document.getElementById('meetingDuration').value);
    
    const start = new Date(`${date}T${time}`);
    
    try {
        const response = await fetch(`${API_URL}/host/${hostId}/meetings`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ start: start.toISOString(), duration })
        });

        if (response.ok) {
            document.getElementById('addMeetingModal').style.display = 'none';
            document.getElementById('addMeetingForm').reset();
            await recalculate();
        } else {
            alert('Erreur lors de la création du créneau');
        }
    } catch (error) {
        console.error('Erreur:', error);
        alert('Erreur de connexion au serveur');
    }
});

// Charger les données au démarrage
loadData();