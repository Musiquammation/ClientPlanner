const API_URL = '/api';
let currentMeetings = [];
let currentResults = [];
let selectedAvailabilities = new Map(); // meetingId -> cost
let currentHostId = null;
let clientId = null;
let currentSelectedMeetingId = null;

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
        }
    } catch (error) {
        console.error('Erreur:', error);
    }
}

// Charger la liste des hôtes du client
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
    
    // Mettre à jour l'URL
    const newUrl = new URL(window.location);
    newUrl.searchParams.set('host', hostId);
    window.history.pushState({}, '', newUrl);
    
    // Afficher l'interface de disponibilités
    document.getElementById('hostSelector').style.display = 'none';
    document.getElementById('availabilityInterface').style.display = 'block';
    
    // Charger les données
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
            
            // Charger les disponibilités existantes du client
            selectedAvailabilities.clear();
            data.availabilities.forEach(avail => {
                selectedAvailabilities.set(avail.meeting_id, avail.cost);
            });
            
            renderClientPlanner();
        }
    } catch (error) {
        console.error('Erreur:', error);
    }
}

// Afficher le planning client
function renderClientPlanner() {
    const grid = document.getElementById('clientPlannerGrid');
    
    if (currentMeetings.length === 0) {
        grid.innerHTML = '<div class="loading">Aucun créneau disponible pour le moment</div>';
        return;
    }

    // Trier les meetings par date
    const sortedMeetings = [...currentMeetings].sort((a, b) => 
        new Date(a.start) - new Date(b.start)
    );

    grid.innerHTML = sortedMeetings.map(meeting => {
        const result = currentResults.find(r => r.meeting_id === meeting.id && r.client_id === clientId);
        const isFixed = result?.fixed || false;
        const isSelected = selectedAvailabilities.has(meeting.id);
        const cost = selectedAvailabilities.get(meeting.id) || 50;
        
        // Vérifier si le créneau est réservé par un autre client
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

        let statusClass = '';
        let statusText = '';
        
        if (isFixed) {
            statusClass = 'fixed';
            statusText = '✓ Votre RDV fixé';
        } else if (isReservedByOther) {
            statusClass = 'reserved';
            statusText = 'Réservé';
        } else if (isSelected) {
            statusClass = 'selected';
            statusText = `Sélectionné (${cost}%)`;
        } else {
            statusText = 'Disponible';
        }

        return `
            <div class="time-slot ${statusClass} ${isReservedByOther ? 'reserved' : ''}" 
                 data-meeting-id="${meeting.id}"
                 ${!isFixed && !isReservedByOther ? 'style="cursor: pointer;"' : ''}>
                <div class="slot-time">${timeStr}</div>
                <div class="slot-status">${statusText}</div>
            </div>
        `;
    }).join('');

    // Ajouter les événements de clic
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

// Basculer la sélection d'un créneau
function toggleSlotSelection(meetingId) {
    if (selectedAvailabilities.has(meetingId)) {
        // Désélectionner
        selectedAvailabilities.delete(meetingId);
        document.getElementById('costSliderContainer').style.display = 'none';
        currentSelectedMeetingId = null;
    } else {
        // Sélectionner et afficher le slider
        currentSelectedMeetingId = meetingId;
        const currentCost = selectedAvailabilities.get(meetingId) || 50;
        selectedAvailabilities.set(meetingId, currentCost);
        
        // Afficher et configurer le slider
        document.getElementById('costSlider').value = currentCost;
        document.getElementById('costPercentage').textContent = `${currentCost}%`;
        document.getElementById('costSliderContainer').style.display = 'block';
        
        // Scroll vers le slider
        document.getElementById('costSliderContainer').scrollIntoView({ 
            behavior: 'smooth', 
            block: 'nearest' 
        });
    }
    
    renderClientPlanner();
}

// Gérer le slider de coût
document.getElementById('costSlider').addEventListener('input', (e) => {
    const cost = parseInt(e.target.value);
    document.getElementById('costPercentage').textContent = `${cost}%`;
    
    if (currentSelectedMeetingId) {
        selectedAvailabilities.set(currentSelectedMeetingId, cost);
        renderClientPlanner();
    }
});

// Mettre à jour les stats
function updateClientStats() {
    const selected = selectedAvailabilities.size;
    const fixed = currentResults.filter(r => 
        r.fixed && r.client_id === clientId
    ).length;
    
    document.getElementById('selectedSlots').textContent = selected;
    document.getElementById('fixedSlots').textContent = fixed;
}

// Sauvegarder les disponibilités
document.getElementById('saveAvailabilitiesBtn').addEventListener('click', async () => {
    const requestedHours = parseFloat(document.getElementById('requestedHours').value);
    
    if (selectedAvailabilities.size === 0) {
        alert('Veuillez sélectionner au moins un créneau');
        return;
    }
    
    const availabilities = Array.from(selectedAvailabilities.entries()).map(([meetingId, cost]) => ({
        meetingId,
        cost
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
            alert('Vos disponibilités ont été enregistrées ! Le planning sera recalculé.');
            await loadHostData(currentHostId);
        } else {
            alert('Erreur lors de l\'enregistrement');
        }
    } catch (error) {
        console.error('Erreur:', error);
        alert('Erreur de connexion au serveur');
    }
});

// Boutons de navigation
document.getElementById('backToHomeBtn').addEventListener('click', () => {
    window.location.href = '/index.html';
});

document.getElementById('changeHostBtn').addEventListener('click', () => {
    document.getElementById('hostSelector').style.display = 'block';
    document.getElementById('availabilityInterface').style.display = 'none';
    
    // Retirer le host de l'URL
    const newUrl = new URL(window.location);
    newUrl.searchParams.delete('host');
    window.history.pushState({}, '', newUrl);
});

// Initialisation
loadClientInfo();

if (hostParam) {
    selectHost(hostParam);
} else {
    loadHosts();
}