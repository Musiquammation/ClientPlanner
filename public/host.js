const API_URL = '/api';
let currentMeetings = [];
let currentResults = [];
let currentClients = [];
let selectedMeetingId = null;
let simulatedResults = [];
let allDisponibilities = [];

const hostToken = localStorage.getItem('hostToken');
const hostId = localStorage.getItem('hostId');

if (!hostToken || !hostId) {
    window.location.href = '/index.html';
}

const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${hostToken}`
};

// Charger les données
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
            simulatePlanning();
        }

        if (clientsRes.ok) {
            currentClients = await clientsRes.json();
            renderClientsList();
            updateStats();
        }
    } catch (error) {
        console.error('Erreur:', error);
    }
}

// Afficher la liste des clients
function renderClientsList() {
    const clientsList = document.getElementById('clientsList');
    
    if (currentClients.length === 0) {
        clientsList.innerHTML = '<div class="loading">Aucun client. Ajoutez-en un pour commencer.</div>';
        return;
    }

    clientsList.innerHTML = currentClients.map(client => `
        <div class="client-item">
            <div style="flex: 1;">
                <div class="client-name">${client.name}</div>
                <div class="client-email">${client.email}</div>
                <div style="font-size: 0.75rem; color: var(--gray-600); margin-top: 0.25rem;">
                    Score: ${Math.round(client.score || 0)} | 
                    Pénalité manque: ${client.missing_cost || 150}
                </div>
            </div>
            <div style="display: flex; gap: 0.5rem;">
                <button class="btn btn-secondary btn-small edit-missing-cost-btn" 
                        data-client-id="${client.id}" 
                        data-current-cost="${client.missing_cost || 150}">
                    ⚙️
                </button>
                <button class="btn btn-danger btn-small delete-client-btn" data-client-ref="${client.ref}">
                    Supprimer
                </button>
            </div>
        </div>
    `).join('');

    // Événements de suppression
    document.querySelectorAll('.delete-client-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteClient(btn.dataset.clientRef);
        });
    });

    // Événements d'édition missing_cost
    document.querySelectorAll('.edit-missing-cost-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            editMissingCost(btn.dataset.clientId, parseFloat(btn.dataset.currentCost));
        });
    });
}

// Éditer le missing_cost
async function editMissingCost(clientId, currentCost) {
    const newCost = prompt(`Pénalité de manque pour ce client (50-500) :\n\nPlus élevé = plus important de placer ce client`, currentCost);
    
    if (newCost === null) return;
    
    const cost = parseFloat(newCost);
    if (isNaN(cost) || cost < 50 || cost > 500) {
        alert('Veuillez entrer un nombre entre 50 et 500');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/host/${hostId}/clients/${clientId}/missing-cost`, {
            method: 'PATCH',
            headers: authHeaders,
            body: JSON.stringify({ missing_cost: cost })
        });

        if (response.ok) {
            await loadData();
            simulatePlanning();
        } else {
            alert('Erreur lors de la mise à jour');
        }
    } catch (error) {
        console.error('Erreur:', error);
        alert('Erreur de connexion');
    }
}

// Supprimer un client
async function deleteClient(clientRef) {
    if (!confirm('Voulez-vous vraiment supprimer ce client ?')) return;

    try {
        const response = await fetch(`${API_URL}/host/${hostId}/clients/${clientRef}`, {
            method: 'DELETE',
            headers: authHeaders
        });

        if (response.ok) {
            await loadData();
            alert('Client supprimé');
        } else {
            alert('Erreur lors de la suppression');
        }
    } catch (error) {
        console.error('Erreur:', error);
        alert('Erreur de connexion');
    }
}

// Simuler le planning côté hôte
async function simulatePlanning() {
    if (currentMeetings.length === 0 || currentClients.length === 0) {
        simulatedResults = [];
        updateSimulationDisplay();
        return;
    }
    
    try {
        // Récupérer les disponibilités de tous les clients
        const disponibilitiesPromises = currentClients.map(async client => {
            const response = await fetch(`${API_URL}/client/${client.id}/host/${hostId}/meetings`);
            if (response.ok) {
                const data = await response.json();
                return {
                    clientId: client.id,
                    availabilities: data.availabilities
                };
            }
            return { clientId: client.id, availabilities: [] };
        });
        
        const disponibilitiesData = await Promise.all(disponibilitiesPromises);
        
        // Préparer les données pour planify
        const fixedResults = currentResults.filter(r => r.fixed);
        
        const users = currentClients.map(client => {
            const clientDispos = disponibilitiesData.find(d => d.clientId === client.id);
            return {
                userId: client.id,
                score: client.score || 0,
                missing_cost: client.missing_cost || 150,
                requestedHours: 1,
                disponibilities: (clientDispos?.availabilities || []).map(a => ({
                    meetingId: a.meeting_id,
                    cost: a.cost
                }))
            };
        });
        
        // Appeler planify
        simulatedResults = planify(currentMeetings, fixedResults, users);
        updateSimulationDisplay();
        
    } catch (error) {
        console.error('Erreur simulation:', error);
        simulatedResults = [];
        updateSimulationDisplay();
    }
}

// Afficher la simulation
function updateSimulationDisplay() {
    const simulationDiv = document.getElementById('simulationSection');
    
    if (!simulationDiv) return;
    
    if (simulatedResults.length === 0) {
        simulationDiv.innerHTML = `
            <h3>Simulation du planning</h3>
            <p class="help-text">Aucune proposition pour le moment</p>
        `;
        return;
    }
    
    const resultsByMeeting = new Map();
    simulatedResults.forEach(r => {
        resultsByMeeting.set(r.meeting_id, r.client_id);
    });
    
    const sortedMeetings = [...currentMeetings]
        .filter(m => resultsByMeeting.has(m.id))
        .sort((a, b) => new Date(a.start) - new Date(b.start));
    
    simulationDiv.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <h3>Simulation du planning</h3>
            <button class="btn btn-primary btn-small" id="sendPlanningBtn">
                Envoyer ce planning aux clients
            </button>
        </div>
        <div class="planner-grid">
            ${sortedMeetings.map(meeting => {
                const clientId = resultsByMeeting.get(meeting.id);
                const client = currentClients.find(c => c.id === clientId);
                
                const date = new Date(meeting.start);
                const timeStr = date.toLocaleString('fr-FR', { 
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                
                return `
                    <div class="time-slot" style="background: #EEF2FF; border-color: #4F46E5;">
                        <div class="slot-time">${timeStr}</div>
                        <div class="slot-status">Proposé</div>
                        ${client ? `<div class="slot-client">${client.name}</div>` : ''}
                    </div>
                `;
            }).join('')}
        </div>
    `;
    
    document.getElementById('sendPlanningBtn')?.addEventListener('click', sendPlanning);
}

// Envoyer le planning
async function sendPlanning() {
    if (!confirm('Envoyer ce planning aux clients ? Cela remplacera les propositions actuelles (hors RDV fixés).')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/host/${hostId}/send-planning`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ results: simulatedResults })
        });

        if (response.ok) {
            alert('Planning envoyé avec succès !');
            await loadData();
        } else {
            alert('Erreur lors de l\'envoi');
        }
    } catch (error) {
        console.error('Erreur:', error);
        alert('Erreur de connexion');
    }
}

// Afficher le planning
function renderPlanner() {
    const grid = document.getElementById('plannerGrid');
    
    if (currentMeetings.length === 0) {
        grid.innerHTML = '<div class="loading">Aucun créneau disponible</div>';
        return;
    }

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

// Suite de host.js...

// Ouvrir la modal pour fixer
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
    
    // Afficher tous les clients (pas seulement ceux disponibles)
    const clientList = document.getElementById('clientList');
    
    if (currentClients.length === 0) {
        clientList.innerHTML = '<div class="loading">Aucun client</div>';
    } else {
        clientList.innerHTML = currentClients.map(client => `
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

// Fixer un RDV
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
            simulatePlanning();
            alert('Rendez-vous fixé ! Un email a été envoyé au client.');
        } else {
            alert('Erreur lors de la fixation');
        }
    } catch (error) {
        console.error('Erreur:', error);
        alert('Erreur de connexion');
    }
}

// Défixer un RDV
async function unfixMeeting(meetingId) {
    if (!confirm('Voulez-vous vraiment défixer ce rendez-vous ?')) return;

    try {
        const response = await fetch(`${API_URL}/host/${hostId}/unfix-meeting`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ meetingId: parseInt(meetingId) })
        });

        if (response.ok) {
            await loadData();
            simulatePlanning();
            alert('Rendez-vous défixé');
        } else {
            alert('Erreur');
        }
    } catch (error) {
        console.error('Erreur:', error);
        alert('Erreur de connexion');
    }
}

// Supprimer un meeting
async function deleteMeeting(meetingId) {
    if (!confirm('Voulez-vous vraiment supprimer ce créneau ?')) return;

    try {
        const response = await fetch(`${API_URL}/host/${hostId}/meetings/${meetingId}`, {
            method: 'DELETE',
            headers: authHeaders
        });

        if (response.ok) {
            await loadData();
            simulatePlanning();
        } else {
            alert('Erreur lors de la suppression');
        }
    } catch (error) {
        console.error('Erreur:', error);
        alert('Erreur de connexion');
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

document.getElementById('addMeetingBtn').addEventListener('click', () => {
    document.getElementById('addMeetingModal').style.display = 'block';
});

document.getElementById('addClientBtn').addEventListener('click', () => {
    document.getElementById('addClientModal').style.display = 'block';
    document.getElementById('searchClientSection').style.display = 'block';
    document.getElementById('addNewClientForm').style.display = 'none';
    document.getElementById('clientSearchInput').value = '';
    document.getElementById('clientSuggestions').style.display = 'none';
});

document.getElementById('cancelAddBtn').addEventListener('click', () => {
    document.getElementById('addMeetingModal').style.display = 'none';
});

document.getElementById('cancelAddClientBtn').addEventListener('click', () => {
    document.getElementById('addClientModal').style.display = 'none';
});

document.getElementById('showNewClientFormBtn').addEventListener('click', () => {
    document.getElementById('searchClientSection').style.display = 'none';
    document.getElementById('addNewClientForm').style.display = 'block';
});

document.getElementById('backToSearchBtn').addEventListener('click', () => {
    document.getElementById('searchClientSection').style.display = 'block';
    document.getElementById('addNewClientForm').style.display = 'none';
    document.getElementById('addNewClientForm').reset();
});

document.getElementById('cancelFixBtn').addEventListener('click', () => {
    document.getElementById('fixMeetingModal').style.display = 'none';
});

// Recherche de client
let searchTimeout;
document.getElementById('clientSearchInput').addEventListener('input', async (e) => {
    const query = e.target.value.trim();
    
    clearTimeout(searchTimeout);
    
    if (query.length < 2) {
        document.getElementById('clientSuggestions').style.display = 'none';
        return;
    }
    
    searchTimeout = setTimeout(async () => {
        try {
            const response = await fetch(`${API_URL}/clients/search?q=${encodeURIComponent(query)}`, {
                headers: authHeaders
            });
            
            if (response.ok) {
                const suggestions = await response.json();
                displayClientSuggestions(suggestions);
            }
        } catch (error) {
            console.error('Erreur:', error);
        }
    }, 300);
});

// Afficher suggestions
function displayClientSuggestions(suggestions) {
    const suggestionsDiv = document.getElementById('clientSuggestions');
    
    if (suggestions.length === 0) {
        suggestionsDiv.style.display = 'none';
        return;
    }
    
    suggestionsDiv.innerHTML = suggestions.map(client => `
        <div class="suggestion-item" data-client-ref="${client.ref}">
            <div class="client-name">${client.name}</div>
            <div class="client-email">${client.email}</div>
        </div>
    `).join('');
    
    suggestionsDiv.style.display = 'block';
    
    suggestionsDiv.querySelectorAll('.suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
            addExistingClient(item.dataset.clientRef);
        });
    });
}

// Ajouter client existant
async function addExistingClient(clientRef) {
    try {
        const response = await fetch(`${API_URL}/host/${hostId}/clients/connect`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ clientRef })
        });

        if (response.ok) {
            document.getElementById('addClientModal').style.display = 'none';
            await loadData();
            simulatePlanning();
            alert('Client ajouté ! Un email lui a été envoyé.');
        } else {
            const error = await response.json();
            alert(error.message || 'Erreur');
        }
    } catch (error) {
        console.error('Erreur:', error);
        alert('Erreur de connexion');
    }
}

// Créer nouveau client
document.getElementById('addNewClientForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('newClientNameInput').value.trim();
    const email = document.getElementById('newClientEmailInput').value.trim();
    
    try {
        const response = await fetch(`${API_URL}/host/${hostId}/clients`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ name, email })
        });

        if (response.ok) {
            document.getElementById('addClientModal').style.display = 'none';
            document.getElementById('addNewClientForm').reset();
            await loadData();
            simulatePlanning();
            alert('Client créé ! Un email lui a été envoyé avec son lien d\'accès.');
        } else {
            const error = await response.json();
            alert(error.message || 'Erreur');
        }
    } catch (error) {
        console.error('Erreur:', error);
        alert('Erreur de connexion');
    }
});

// Créer meeting
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
            await loadData();
            simulatePlanning();
        } else {
            alert('Erreur');
        }
    } catch (error) {
        console.error('Erreur:', error);
        alert('Erreur de connexion');
    }
});

// Charger les données
loadData();