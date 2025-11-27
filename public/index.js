const API_URL = 'http://localhost:3000/api';

// Gestion des tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        btn.classList.add('active');
        document.getElementById(tab).classList.add('active');
    });
});

// Connexion hôte
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        const response = await fetch(`${API_URL}/host/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        if (response.ok) {
            const data = await response.json();
            localStorage.setItem('hostToken', data.token);
            localStorage.setItem('hostId', data.hostId);
            window.location.href = '/host.html';
        } else {
            alert('Identifiants incorrects');
        }
    } catch (error) {
        console.error('Erreur de connexion:', error);
        alert('Erreur de connexion au serveur');
    }
});

// Inscription hôte
document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('registerName').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    
    try {
        const response = await fetch(`${API_URL}/host/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password })
        });
        
        if (response.ok) {
            const data = await response.json();
            alert('Compte créé avec succès ! Vous pouvez maintenant vous connecter.');
            document.querySelector('[data-tab="login"]').click();
        } else {
            const error = await response.json();
            alert(error.message || 'Erreur lors de la création du compte');
        }
    } catch (error) {
        console.error('Erreur d\'inscription:', error);
        alert('Erreur de connexion au serveur');
    }
});

// Accès client
document.getElementById('clientAccessForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const clientId = document.getElementById('clientId').value;
    
    try {
        // Vérifier que le client existe
        const response = await fetch(`${API_URL}/client/${clientId}`);
        
        if (response.ok) {
            window.location.href = `/clienthome.html?id=${clientId}`;
        } else {
            alert('ID client non trouvé');
        }
    } catch (error) {
        console.error('Erreur:', error);
        alert('Erreur de connexion au serveur');
    }
});