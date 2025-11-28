const API_URL = '/api';
let currentMeetings = [];
let currentResults = [];
let currentClients = [];
let selectedAvailabilities = new Map();
let currentHostId = null;
let clientId = null;
let currentSelectedMeetingId = null;
let autoSaveTimeout = null;
let simulatedResults = [];

// Récupérer l'ID client depuis l'URL
const urlParams = new URLSearchParams(window.location.search);
clientId = urlParams.get('id');
const hostParam = urlParams.get('host');

if (!clientId) {
    window.location.href = '/index.html';
}

// Charger les infos du client
async function loadClientInfo() {
    try {
        const response = await fetch(`${API_URL}/client/${clientId}`);
        if (response.ok) {
            const client = await response.json();
            document.getElementById('clientName').textContent = client.name;
            
            // Afficher le score
            if (client.score !== undefined) {
                document.getElementById('clientScore').textContent = Math.round(client.score);
            }
        }
    } catch (error) {
        console.error('Erreur:', error);
    }
}

// Charger la liste des hôtes
async function loadHosts() {
    try {
        const response = await fetch(`${API_URL}/client/${clientId}/hosts`);
        if (response.ok) {
            const hosts = await response.json();
            renderHostList(hosts);
        }
    } catch (error) {
        console.error('Erreur:', error);
    }
}

// Afficher la liste des hôtes
function renderHostList(hosts) {
    const hostList = document.getElementById('hostList');
    
    if (hosts.length === 0) {
        hostList.innerHTML = '<div class="loading">Aucun hôte associé à votre compte</div>';
        return;
    }

    hostList.innerHTML = hosts.map(host => `
        <div class="client-item" data-host-id="${host.id}">
            <div class="client-name">${host.name}</div>
            <div class="client-email">${host.email}</div>
        </div>
    `).join('');

    hostList.querySelectorAll('.client-item').forEach(item => {
        item.addEventListener('click', () => {
            selectHost(item.dataset.hostId);
        });
    });
}

// Sélectionner un hôte
async function selectHost(hostId) {
    currentHostId = hostId;
    
    const newUrl = new URL(window.location);
    newUrl.searchParams.set('host', hostId);
    window.history.pushState({}, '', newUrl);
    
    document.getElementById('hostSelector').style.display = 'none';
    document.getElementById('availabilityInterface').style.display = 'block';
    
    await loadHostData(hostId);
}

// Charger les données de l'hôte
async function loadHostData(hostId) {
    try {
        const [hostRes, meetingsRes] = await Promise.all([
            fetch(`${API_URL}/host/${hostId}`),
            fetch(`${API_URL}/client/${clientId}/host/${hostId}/meetings`)
        ]);

        if (hostRes.ok) {
            const host = await hostRes.json();
            document.getElementById('selectedHostName').textContent = host.name;
        }

        if (meetingsRes.ok) {
            const data = await meetingsRes.json();
            currentMeetings = data.meetings;
            currentResults = data.results;
            currentClients = data.clients || [];
            
            selectedAvailabilities.clear();
            data.availabilities.forEach(avail => {
                selectedAvailabilities.set(avail.meeting_id, 100 - avail.cost);
            });
            
            renderClientPlanner();
            simulatePlanning();
        }
    } catch (error) {
        console.error('Erreur:', error);
    }
}

// Simuler le planning côté client
function simulatePlanning() {
    if (currentMeetings.length === 0 || selectedAvailabilities.size === 0) {
        simulatedResults = [];
        updateSimulationDisplay();
        return;
    }
    
    // Préparer les données pour planify
    const fixedResults = currentResults.filter(r => r.fixed);
    
    const users = [];
    const usersMap = new Map();
    
    // Ajouter tous les clients
    currentClients.forEach(client => {
        usersMap.set(client.id, {
            userId: client.id,
            score: client.score || 0,
            missing_cost: client.missing_cost || 150,
            requestedHours: 1,
            disponibilities: []
        });
    });
    
    // Ajouter les disponibilités du client actuel
    selectedAvailabilities.forEach((preference, meetingId) => {
        if (!usersMap.has(clientId)) {
            usersMap.set(clientId, {
                userId: clientId,
                score: 0,
                missing_cost: 150,
                requestedHours: parseFloat(document.getElementById('requestedHours').value),
                disponibilities: []
            });
        }
        usersMap.get(clientId).disponibilities.push({
            meetingId: meetingId,
            cost: 100 - preference
        });
    });
    
    // Convertir en array
    usersMap.forEach(user => users.push(user));
    
    // Appeler planify
    try {
        simulatedResults = planify(currentMeetings, fixedResults, users);
        updateSimulationDisplay();
    } catch (error) {
        console.error('Erreur simulation:', error);
        simulatedResults = [];
    }
}

// Afficher les résultats simulés
function updateSimulationDisplay() {
    const simulationDiv = document.getElementById('simulationResults');
    
    if (simulatedResults.length === 0) {
        simulationDiv.innerHTML = '<p class="help-text">Aucun créneau proposé pour le moment</p>';
        return;
    }
    
    const myResults = simulatedResults.filter(r => r.client_id === clientId);
    
    if (myResults.length === 0) {
        simulationDiv.innerHTML = '<p class="help-text">Vous n\'avez pas encore de créneaux proposés</p>';
        return;
    }
    
    simulationDiv.innerHTML = '<h3>Créneaux probables pour vous :</h3>' + myResults.map(result => {
        const meeting = currentMeetings.find(m => m.id === result.meeting_id);
        if (!meeting) return '';
        
        const date = new Date(meeting.start);
        const timeStr = date.toLocaleString('fr-FR', { 
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        return `
            <div class="time-slot" style="background: #EEF2FF; border-color: #4F46E5; margin-bottom: 0.5rem;">
                <div class="slot-time">${timeStr}</div>
                <div class="slot-status">📅 Créneau proposé</div>
            </div>
        `;
    }).join('');
}

// Afficher le planning client
function renderClientPlanner() {
    const grid = document.getElementById('clientPlannerGrid');
    
    if (currentMeetings.length === 0) {
        grid.innerHTML = '<div class="loading">Aucun créneau disponible pour le moment</div>';
        return;
    }

    const sortedMeetings = [...currentMeetings].sort((a, b) => 
        new Date(a.start) - new Date(b.start)
    );

    grid.innerHTML = sortedMeetings.map(meeting => {
        const result = currentResults.find(r => r.meeting_id === meeting.id && r.client_id === clientId);
        const isFixed = result?.fixed || false;
        const isSelected = selectedAvailabilities.has(meeting.id);
        const preference = selectedAvailabilities.get(meeting.id) || 100;
        
        const cost = 100 - preference;
        
        const isReservedByOther = currentResults.some(r => 
            r.meeting_id === meeting.id && r.fixed && r.client_id !== clientId
        );
        
        const date = new Date(meeting.start);
        const timeStr = date.toLocaleString('fr-FR', { 
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        });

        let slotClass = '';
        let statusText = '';
        let slotStyle = '';
        
        if (isFixed) {
            slotClass = 'fixed';
            statusText = '✓ Votre RDV fixé';
        } else if (isReservedByOther) {
            slotClass = 'reserved';
            statusText = 'Réservé';
        } else if (isSelected) {
            const hue = preference * 1.2;
            const lightness = 85 + (preference * 0.1);
            slotStyle = `background: hsl(${hue}, 70%, ${lightness}%); border-color: hsl(${hue}, 70%, 60%);`;
            statusText = `Sélectionné (${preference}%)`;
        } else {
            slotClass = 'not-selected';
            statusText = 'Non sélectionné';
        }

        return `
            <div class="time-slot ${slotClass} ${isReservedByOther ? 'reserved' : ''}" 
                 data-meeting-id="${meeting.id}"
                 style="${slotStyle}"
                 ${!isFixed && !isReservedByOther ? 'style="cursor: pointer;"' : ''}>
                <div class="slot-time">${timeStr}</div>
                <div class="slot-status">${statusText}</div>
            </div>
        `;
    }).join('');

    grid.querySelectorAll('.time-slot').forEach(slot => {
        const meetingId = parseInt(slot.dataset.meetingId);
        const isFixed = currentResults.some(r => 
            r.meeting_id === meetingId && r.fixed && r.client_id === clientId
        );
        const isReserved = currentResults.some(r => 
            r.meeting_id === meetingId && r.fixed && r.client_id !== clientId
        );
        
        if (!isFixed && !isReserved) {
            slot.addEventListener('click', () => {
                toggleSlotSelection(meetingId);
            });
        }
    });

    updateClientStats();
}

// Basculer la sélection
function toggleSlotSelection(meetingId) {
    if (selectedAvailabilities.has(meetingId)) {
        selectedAvailabilities.delete(meetingId);
        document.getElementById('costSliderContainer').style.display = 'none';
        currentSelectedMeetingId = null;
    } else {
        currentSelectedMeetingId = meetingId;
        const currentPreference = selectedAvailabilities.get(meetingId) || 100;
        selectedAvailabilities.set(meetingId, currentPreference);
        
        document.getElementById('costSlider').value = currentPreference;
        document.getElementById('costPercentage').textContent = `${currentPreference}%`;
        document.getElementById('costSliderContainer').style.display = 'block';
        
        document.getElementById('costSliderContainer').scrollIntoView({ 
            behavior: 'smooth', 
            block: 'nearest' 
        });
    }
    
    renderClientPlanner();
    simulatePlanning();
    scheduleAutoSave();
}

// Gérer le slider
document.getElementById('costSlider').addEventListener('input', (e) => {
    const preference = parseInt(e.target.value);
    document.getElementById('costPercentage').textContent = `${preference}%`;
    
    if (currentSelectedMeetingId) {
        selectedAvailabilities.set(currentSelectedMeetingId, preference);
        renderClientPlanner();
        simulatePlanning();
        scheduleAutoSave();
    }
});

// Auto-save après 5 secondes d'inactivité
function scheduleAutoSave() {
    if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
    }
    
    autoSaveTimeout = setTimeout(() => {
        saveAvailabilities(true);
    }, 5000);
}

// Sauvegarder les disponibilités
async function saveAvailabilities(isAutoSave = false) {
    const requestedHours = parseFloat(document.getElementById('requestedHours').value);
    
    if (selectedAvailabilities.size === 0) {
        if (!isAutoSave) {
            alert('Veuillez sélectionner au moins un créneau');
        }
        return;
    }
    
    const availabilities = Array.from(selectedAvailabilities.entries()).map(([meetingId, preference]) => ({
        meetingId,
        cost: 100 - preference
    }));
    
    try {
        const response = await fetch(`${API_URL}/client/${clientId}/availabilities`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                hostId: currentHostId,
                requestedHours,
                availabilities
            })
        });

        if (response.ok) {
            if (!isAutoSave) {
                alert('Vos disponibilités ont été enregistrées !');
            }
            document.getElementById('autoSaveIndicator').textContent = '✓ Sauvegardé';
            setTimeout(() => {
                document.getElementById('autoSaveIndicator').textContent = '';
            }, 2000);
        } else {
            if (!isAutoSave) {
                alert('Erreur lors de l\'enregistrement');
            }
        }
    } catch (error) {
        console.error('Erreur:', error);
        if (!isAutoSave) {
            alert('Erreur de connexion au serveur');
        }
    }
}

// Mettre à jour les stats
function updateClientStats() {
    const selected = selectedAvailabilities.size;
    const fixed = currentResults.filter(r => 
        r.fixed && r.client_id === clientId
    ).length;
    
    document.getElementById('selectedSlots').textContent = selected;
    document.getElementById('fixedSlots').textContent = fixed;
}

// Bouton sauvegarder
document.getElementById('saveAvailabilitiesBtn').addEventListener('click', async () => {
    if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
    }
    await saveAvailabilities(false);
});

// Boutons de navigation
document.getElementById('backToHomeBtn').addEventListener('click', () => {
    window.location.href = '/index.html';
});

document.getElementById('changeHostBtn').addEventListener('click', () => {
    document.getElementById('hostSelector').style.display = 'block';
    document.getElementById('availabilityInterface').style.display = 'none';
    
    const newUrl = new URL(window.location);
    newUrl.searchParams.delete('host');
    window.history.pushState({}, '', newUrl);
});

// Bouton retour à la session
document.getElementById('backToSessionBtn')?.addEventListener('click', () => {
    if (hostParam) {
        selectHost(hostParam);
    } else {
        loadHosts();
    }
});

// Initialisation
loadClientInfo();

if (hostParam) {
    selectHost(hostParam);
} else {
    loadHosts();
}