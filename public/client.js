const API_URL = '/api';
let currentMeetings = [];
let currentResults = [];
let currentClients = [];
let selectedAvailabilities = new Map();
let currentHostId = null;
let currentSelectedMeetingId = null;
let autoSaveTimeout = null;
let simulatedResults = [];
let currentRequestedHours = 0;


const urlParams = new URLSearchParams(window.location.search);
const passkey = urlParams.get('id');

const clientHeaders = {
	'Content-Type': 'application/json',
	'X-Client-Passkey': passkey
};

let clientId = null;
const hostParam = urlParams.get('host');

if (!passkey) {
	window.location.href = '/index.html';
}

function filterFutureMeetings(meetings) {
	const now = new Date();
	return meetings.filter(meeting => new Date(meeting.start) > now);
}

async function loadClientInfo() {
	try {
		const response = await fetch(`${API_URL}/client/info`, {
			headers: clientHeaders
		});
		if (response.ok) {
			const client = await response.json();
			clientId = client.id; // Stocker l'ID public
			document.getElementById('clientName').textContent = client.name;
			
			if (client.score !== undefined) {
				document.getElementById('clientScore').textContent = Math.round(client.score);
			}
		}
	} catch (error) {
		console.error(error);
	}
}

async function loadHosts() {
	try {
		const response = await fetch(`${API_URL}/client/hosts`, {
			headers: clientHeaders
		});
		if (response.ok) {
			const hosts = await response.json();
			renderHostList(hosts);
		}
	} catch (error) {
		console.error(error);
	}
}

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

async function selectHost(hostId) {
	currentHostId = hostId;
	
	const newUrl = new URL(window.location);
	newUrl.searchParams.set('host', hostId);
	window.history.pushState({}, '', newUrl);
	
	document.getElementById('hostSelector').style.display = 'none';
	document.getElementById('availabilityInterface').style.display = 'block';
	
	await loadHostData(hostId);
}


async function loadHostData(hostId) {
	try {
		const [hostRes, meetingsRes] = await Promise.all([
			fetch(`${API_URL}/host/${hostId}`),
			fetch(`${API_URL}/client/host/${hostId}/meetings`, {
				headers: clientHeaders
			})
		]);

		if (hostRes.ok) {
			const host = await hostRes.json();
			document.getElementById('selectedHostName').textContent = host.name;
		}

		if (meetingsRes.ok) {
			const data = await meetingsRes.json();
			currentMeetings = filterFutureMeetings(data.meetings);
			currentResults = data.results;
			currentClients = data.clients || [];
			currentRequestedHours = data.requested_hours || 0;
			
			// Mettre à jour l'input
			document.getElementById('requestedHours').value = currentRequestedHours;
			
			selectedAvailabilities.clear();
			data.availabilities.forEach(avail => {
				if (currentMeetings.some(m => m.id === avail.meeting_id)) {
					selectedAvailabilities.set(avail.meeting_id, 100 - avail.cost);
				}
			});
			
			renderClientPlanner();
			renderFixedMeetings();
			simulatePlanning();
		}
	} catch (error) {
		console.error(error);
	}
}


function simulatePlanning() {
	if (currentMeetings.length === 0 || selectedAvailabilities.size === 0) {
		simulatedResults = [];
		updateSimulationDisplay();
		return;
	}
	
	const fixedResults = currentResults.filter(r => r.fixed);
	
	const users = [];
	const usersMap = new Map();
	
	// D'abord créer les entrées pour tous les clients avec leurs vraies requestedHours
	currentClients.forEach(client => {
		usersMap.set(client.id, {
			userId: client.id,
			score: client.score || 0,
			missing_cost: client.missing_cost || 150,
			requestedHours: 1, // Valeur par défaut, sera écrasée si disponible
			disponibilities: client.disponibilities || []
		});
	});
	
	// Ensuite, ajouter/mettre à jour les disponibilités du client courant
	selectedAvailabilities.forEach((preference, meetingId) => {
		if (!usersMap.has(clientId)) {
			usersMap.set(clientId, {
				userId: clientId,
				score: 0,
				missing_cost: 150,
				requestedHours: currentRequestedHours,
				disponibilities: []
			});
		} else {
			// Mettre à jour les requestedHours du client courant
			usersMap.get(clientId).requestedHours = currentRequestedHours;
		}
		usersMap.get(clientId).disponibilities.push({
			meetingId: meetingId,
			cost: 100 - preference
		});
	});
	
	usersMap.forEach(user => users.push(user));
	
	try {
		simulatedResults = planify(currentMeetings, fixedResults, users);
		updateSimulationDisplay();
	} catch (error) {
		console.error('Erreur simulation:', error);
		simulatedResults = [];
	}
}


function updateSimulationDisplay() {
	const simulationDiv = document.getElementById('simulationResults');
	
	if (simulatedResults.length === 0) {
		simulationDiv.innerHTML = '<p class="help-text">Aucun créneau proposé pour le moment</p>';
		return;
	}
	
	// Filtrer les résultats non fixés pour moi
	const myResults = simulatedResults.filter(r => {
		if (r.client_id !== clientId) return false;
		const existingResult = currentResults.find(cr => 
			cr.meeting_id === r.meeting_id && cr.client_id === r.client_id
		);
		return !existingResult || !existingResult.fixed;
	});
	
	if (myResults.length === 0) {
		simulationDiv.innerHTML = '<p class="help-text">Vous n\'avez pas de créneaux proposés en attente</p>';
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

// Afficher les RDV fixés
function renderFixedMeetings() {
	const fixedSection = document.getElementById('fixedMeetingsSection');
	
	if (!fixedSection) return;
	
	const myFixedResults = currentResults.filter(r => r.fixed && r.client_id === clientId);
	
	if (myFixedResults.length === 0) {
		fixedSection.innerHTML = `
			<h2>Mes rendez-vous fixés</h2>
			<p class="help-text">Aucun rendez-vous fixé pour le moment</p>
		`;
		return;
	}
	
	const sortedFixed = myFixedResults
		.map(r => ({
			result: r,
			meeting: currentMeetings.find(m => m.id === r.meeting_id)
		}))
		.filter(item => item.meeting)
		.sort((a, b) => new Date(a.meeting.start) - new Date(b.meeting.start));
	
	fixedSection.innerHTML = `
		<h2>Mes rendez-vous fixés</h2>
		<div class="planner-grid">
			${sortedFixed.map(({ meeting, result }) => {
				const date = new Date(meeting.start);
				const timeStr = date.toLocaleString('fr-FR', { 
					weekday: 'long',
					day: 'numeric',
					month: 'long',
					hour: '2-digit',
					minute: '2-digit'
				});
				
				return `
					<div class="time-slot fixed">
						<div class="slot-time">${timeStr}</div>
						<div class="slot-status">✓ Rendez-vous confirmé</div>
						<div class="host-controls">
							<button class="btn btn-danger btn-small cancel-meeting-btn" 
									data-meeting-id="${meeting.id}">
								Annuler
							</button>
						</div>
					</div>
				`;
			}).join('')}
		</div>
	`;
	
	document.querySelectorAll('.cancel-meeting-btn').forEach(btn => {
		btn.addEventListener('click', async (e) => {
			e.stopPropagation();
			await cancelMeeting(btn.dataset.meetingId);
		});
	});
}

// Annuler un RDV fixé
async function cancelMeeting(meetingId) {
	if (!confirm('Voulez-vous vraiment annuler ce rendez-vous ?')) return;

	try {
		const response = await fetch(`${API_URL}/client/cancel-meeting`, {
			method: 'POST',
			headers: clientHeaders,
			body: JSON.stringify({ 
				meetingId: parseInt(meetingId),
				hostId: currentHostId // NOUVEAU
			})
		});

		if (response.ok) {
			// Incrémenter localement
			currentRequestedHours += 1;
			document.getElementById('requestedHours').value = currentRequestedHours;
			
			await loadHostData(currentHostId);
			alert('Rendez-vous annulé');
		} else {
			const error = await response.json();
			alert(error.error || 'Erreur lors de l\'annulation');
		}
	} catch (error) {
		console.error(error);
		alert('Erreur de connexion');
	}
}


function renderClientPlanner() {
	const grid = document.getElementById('clientPlannerGrid');
	
	if (currentMeetings.length === 0) {
		grid.innerHTML = '<div class="loading">Aucun créneau futur disponible pour le moment</div>';
		return;
	}

	const sortedMeetings = [...currentMeetings].sort((a, b) => 
		new Date(a.start) - new Date(b.start)
	);

	grid.innerHTML = sortedMeetings.map(meeting => {
		const result = currentResults.find(r => r.meeting_id === meeting.id && r.client_id === clientId);
		const isFixed = result?.fixed || false;
		
		// Ne pas afficher les créneaux fixés dans le planning
		if (isFixed) return '';
		
		const isSelected = selectedAvailabilities.has(meeting.id);
		const preference = selectedAvailabilities.get(meeting.id) || 100;
		
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
		
		if (isReservedByOther) {
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
				 ${!isReservedByOther ? 'style="cursor: pointer;"' : ''}>
				<div class="slot-time">${timeStr}</div>
				<div class="slot-status">${statusText}</div>
			</div>
		`;
	}).filter(html => html).join('');

	grid.querySelectorAll('.time-slot').forEach(slot => {
		const meetingId = parseInt(slot.dataset.meetingId);
		const isReserved = currentResults.some(r => 
			r.meeting_id === meetingId && r.fixed && r.client_id !== clientId
		);
		
		if (!isReserved) {
			slot.addEventListener('click', () => {
				toggleSlotSelection(meetingId);
			});
		}
	});

	updateClientStats();
}

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

function scheduleAutoSave() {
	if (autoSaveTimeout) {
		clearTimeout(autoSaveTimeout);
	}
	
	autoSaveTimeout = setTimeout(() => {
		saveAvailabilities(true);
	}, 5000);
}

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
		const response = await fetch(`${API_URL}/client/availabilities`, {
			method: 'POST',
			headers: clientHeaders,
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
		console.error(error);
		if (!isAutoSave) {
			alert('Erreur de connexion au serveur');
		}
	}
}

function updateClientStats() {
	const selected = selectedAvailabilities.size;
	const fixed = currentResults.filter(r => 
		r.fixed && r.client_id === clientId
	).length;
	
	document.getElementById('selectedSlots').textContent = selected;
	document.getElementById('fixedSlots').textContent = fixed;
}

document.getElementById('saveAvailabilitiesBtn').addEventListener('click', async () => {
	if (autoSaveTimeout) {
		clearTimeout(autoSaveTimeout);
	}
	await saveAvailabilities(false);
});

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

document.getElementById('backToSessionBtn')?.addEventListener('click', () => {
	if (hostParam) {
		selectHost(hostParam);
	} else {
		loadHosts();
	}
});



document.getElementById('requestedHours').addEventListener('change', async (e) => {
	const newValue = parseInt(e.target.value);
	if (newValue < 0 || isNaN(newValue)) {
		e.target.value = currentRequestedHours;
		return;
	}
	
	try {
		const response = await fetch(`${API_URL}/client/host/${currentHostId}/requested-hours`, {
			method: 'PATCH',
			headers: clientHeaders,
			body: JSON.stringify({ requested_hours: newValue })
		});
		
		if (response.ok) {
			currentRequestedHours = newValue;
			simulatePlanning();
		} else {
			e.target.value = currentRequestedHours;
			alert('Erreur lors de la mise à jour');
		}
	} catch (error) {
		console.error(error);
		e.target.value = currentRequestedHours;
	}
});









loadClientInfo();


if (hostParam) {
	selectHost(hostParam);
} else {
	loadHosts();
}