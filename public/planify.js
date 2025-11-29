/**
 * Évalue le score de distribution (plus c'est bas, mieux c'est)
 */
function evalDistributionScore(arr) {
	if (!arr.length) return 0;
	
	const mean = arr.reduce((sum, x) => sum + x, 0) / arr.length;
	return mean ;
}

/**
 * Calcule le nouveau score d'un utilisateur spécifique
 * @param {Array} meetings - Liste des meetings
 * @param {Array} fixedResults - Résultats déjà fixés
 * @param {Array} users - Liste des utilisateurs avec leurs scores et disponibilités
 * @param {number} userIdx - Index de l'utilisateur dont on calcule le score
 * @returns {number} - Nouveau score de l'utilisateur
 */
function getNewScore(meetings, fixedResults, users, userIdx) {
	const user = users[userIdx];
	let score = user.score || 0;
	
	// Créer un Map des disponibilités pour accès rapide
	const availMap = new Map();
	user.disponibilities.forEach(d => {
		availMap.set(d.meetingId, d.cost);
	});
	
	// Compter combien de créneaux fixés pour cet utilisateur
	let assignedCount = 0;
	
	fixedResults.forEach(result => {
		if (result.client_id === user.userId) {
			assignedCount++;
			const cost = availMap.get(result.meeting_id);
			if (cost !== undefined) {
				score += cost;
			}
		}
	});
	
	// Pénalité si pas assez de créneaux assignés
	const missingCount = Math.max(0, user.requestedHours - assignedCount);
	score += missingCount * (user.missing_cost || 150);
	
	return score;
}

/**
 * Fonction de planification intelligente
 * Génère toutes les combinaisons possibles et choisit la meilleure
 * 
 * @param {Array} meetings - Liste des créneaux disponibles
 * @param {Array} fixedResults - Résultats déjà fixés (ne pas toucher)
 * @param {Array} users - Liste des utilisateurs avec leurs disponibilités
 * 

 * @returns {Array} - Nouveaux résultats [{meeting_id, client_id}]
 */
function planify(meetings, fixedResults, users) {
	// Créneaux déjà fixés qu'on ne doit pas toucher
	const fixedMeetingIds = new Set(fixedResults.map(r => r.meeting_id));
	
	// Compteur d'attributions par utilisateur
	const userAssignmentCount = new Map();
	users.forEach(u => userAssignmentCount.set(u.userId, 0));
	
	// Créneaux disponibles (non fixés)
	const availableMeetings = meetings.filter(m => !fixedMeetingIds.has(m.id));
	
	let bestScore = Infinity;
	let bestCombination = [];
	
	/**
	 * Évalue le score d'une combinaison donnée
	 */
	function evalScore(combination) {
		// Initialiser les scores avec les scores actuels des utilisateurs
		const scores = users.map(u => u.score || 0);
		const assignedCounts = users.map(() => 0);
		
		// Créer des maps de disponibilités pour accès rapide
		const availMaps = users.map(u => {
			const map = new Map();
			u.disponibilities.forEach(d => {
				map.set(d.meetingId, d.cost);
			});
			return map;
		});
		
		// Ajouter les coûts des créneaux assignés dans la combinaison
		combination.forEach(c => {
			const cost = availMaps[c.userIdx].get(c.meeting.id);
			if (cost !== undefined) {
				scores[c.userIdx] += cost;
			} else {
				// Si pas de disponibilité déclarée, coût très élevé
				scores[c.userIdx] += 200;
			}
			assignedCounts[c.userIdx]++;
		});
		
		// Ajouter les pénalités pour créneaux manquants
		users.forEach((u, idx) => {
			const missing = Math.max(0, u.requestedHours - assignedCounts[idx]);
			scores[idx] += missing * (u.missing_cost || 150);
		});
		
		return evalDistributionScore(scores);
	}
	
	/**
	 * Backtracking pour explorer toutes les combinaisons possibles
	 */
	function backtrack(meetingIdx, currentCombination) {
		// Cas de base : tous les créneaux ont été traités
		if (meetingIdx === availableMeetings.length) {
			const score = evalScore(currentCombination);
			if (score < bestScore) {
				bestScore = score;
				bestCombination = currentCombination.map(c => ({
					meeting_id: c.meeting.id,
					client_id: c.user.userId
				}));
			}
			return;
		}
		
		const meeting = availableMeetings[meetingIdx];
		
		// Essayer d'assigner ce créneau à chaque utilisateur disponible
		for (let userIdx = 0; userIdx < users.length; userIdx++) {
			const user = users[userIdx];
			
			// Vérifier si l'utilisateur a déclaré ce créneau comme disponible
			const isAvailable = user.disponibilities.some(d => d.meetingId === meeting.id);
			
			// Vérifier si l'utilisateur n'a pas déjà atteint son quota
			const currentCount = userAssignmentCount.get(user.userId);
			
			if (isAvailable && currentCount < user.requestedHours) {
				// Assigner ce créneau à cet utilisateur
				userAssignmentCount.set(user.userId, currentCount + 1);
				currentCombination.push({ meeting, user, userIdx });
				
				// Continuer avec le créneau suivant
				backtrack(meetingIdx + 1, currentCombination);
				
				// Backtrack
				currentCombination.pop();
				userAssignmentCount.set(user.userId, currentCount);
			}
		}
		
		// Option : laisser ce créneau non assigné
		backtrack(meetingIdx + 1, currentCombination);
	}
	
	// Lancer l'exploration
	backtrack(0, []);
	
	return bestCombination;
}

// Export pour utilisation dans Node.js
if (typeof module !== 'undefined' && module.exports) {
	module.exports = { planify, getNewScore, evalDistributionScore };
}
