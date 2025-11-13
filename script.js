const ids = Array.from({ length: 10 }, (_, i) => `v${i + 1}`);
let log = JSON.parse(localStorage.getItem('log') || '[]');
const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode') || 'display';
document.body.classList.toggle('display-mode', mode === 'display');

function loadValues() {
    ids.forEach(id => {
        const el = document.getElementById(id);
        const saved = localStorage.getItem(id);
        if (el && saved) el.value = saved;
    });
}

window.onload = () => {
    loadValues();

    if (mode === 'admin') {
        document.querySelectorAll('button').forEach(b => b.style.display = 'inline-block');
        document.getElementById('adminPanel').style.display = 'block';
        document.getElementById('refreshTimer').style.display = 'block';

        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => localStorage.setItem(id, el.value));
        });
    } else {
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.setAttribute('readonly', true);
        });
    }

    startSyncBehavior();
};

function novPar(stolpec) {
    const map = {
        1: ['v1', 'v2'],
        2: ['v3', 'v4'],
        3: ['v5', 'v6']
    };
    const [zg1, zg2] = map[stolpec];
    const next1 = document.getElementById('v7').value.trim();
    const next2 = document.getElementById('v8').value.trim();

    if (!next1 && !next2) return alert("Vnesi naslednji par pred prenosom!");

    const prev1 = document.getElementById(zg1).value;
    const prev2 = document.getElementById(zg2).value;

    document.getElementById(zg1).value = next1;
    document.getElementById(zg2).value = next2;

    document.getElementById('v7').value = document.getElementById('v9').value;
    document.getElementById('v8').value = document.getElementById('v10').value;
    document.getElementById('v9').value = '';
    document.getElementById('v10').value = '';

    ids.forEach(id => localStorage.setItem(id, document.getElementById(id).value));

    const now = new Date().toLocaleString('sl-SI');
    log.push(`${now} - AVTOMAT ${stolpec}: (${prev1 || '-'}, ${prev2 || '-'}) → (${next1 || '-'}, ${next2 || '-'})`);
    localStorage.setItem('log', JSON.stringify(log));
}

function showHistory() {
    const content = document.getElementById('historyContent');
    content.innerHTML = log.length
        ? log.map(e => `<div class="history-entry">${e}</div>`).join('')
        : '<p>Ni zgodovine.</p>';
    document.getElementById('overlay').style.display = 'block';
    document.getElementById('historyModal').style.display = 'block';
}

function closeHistory() {
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('historyModal').style.display = 'none';
}

function clearHistory() {
    if (confirm('Res želiš izbrisati zgodovino?')) {
        log = [];
        localStorage.removeItem('log');
        showHistory();
    }
}

function startSyncBehavior() {
    const timerEl = document.getElementById('refreshTimer');
    const countdownEl = document.getElementById('countdown');
    let countdown = 300;

    if (mode === 'admin') {
        const tick = setInterval(() => {
            countdown--;
            countdownEl.textContent = countdown;
            if (countdown <= 0) triggerDisplayRefresh();
        }, 1000);

        timerEl.addEventListener('click', triggerDisplayRefresh);

        function triggerDisplayRefresh() {
            localStorage.setItem('lastUpdateTime', Date.now().toString());
            location.reload();
        }
    } else {
        window.addEventListener('storage', e => {
            if (e.key === 'lastUpdateTime') location.reload();
        });
    }
}