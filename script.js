let automats = parseInt(localStorage.getItem('automats') || '1');
let log = JSON.parse(localStorage.getItem('log') || '[]');
const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode') || 'display';

document.body.classList.toggle('display-mode', mode === 'display');

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

window.addEventListener("load", () => {
    const title = localStorage.getItem("mainTitle") || "Pikado";
    const titleEl = document.getElementById("mainTitle");
    
    if (mode !== "admin") {
        if (titleEl) {
            const textEl = document.createElement("div");
            textEl.id = "mainTitle";
            textEl.className = "main-title-display";
            textEl.textContent = title;
            titleEl.parentNode.replaceChild(textEl, titleEl);
        }
    } else {
                if (titleEl) {
            titleEl.value = title;
            const debouncedSave = debounce(() => {
                localStorage.setItem("mainTitle", titleEl.value);
                localStorage.setItem('lastUpdateTime', Date.now().toString());
            }, 1000);
            titleEl.addEventListener("input", debouncedSave);
        }
    }
});

function loadValues() {
    for (let i = 1; i <= automats * 2 + 10; i++) {
        const el = document.getElementById(`v${i}`);
        const saved = localStorage.getItem(`v${i}`);
        if (el && saved) el.value = saved;
    }
}

function loadDisplayValues() {
    for (let i = 1; i <= automats; i++) {
        const nameEl = document.getElementById(`name_${i}`);
        const nameKey = `automat_name_${i}`;
        const automatName = localStorage.getItem(nameKey) || `Avtomat ${i}`;
        if (nameEl) nameEl.textContent = automatName;
    }
    
    for (let i = 1; i <= automats * 2 + 10; i++) {
        const el = document.getElementById(`v${i}`);
        const saved = localStorage.getItem(`v${i}`);
        if (el) {
            if (saved) {
                el.textContent = saved;
                el.classList.remove('placeholder-text');
            } else {
                if (i <= automats * 2) {
                    const playerNum = ((i - 1) % 2) + 1;
                    el.textContent = `Igralec ${playerNum}`;
                    el.classList.add('placeholder-text');
                } else {
                    el.textContent = "";
                    el.classList.remove('placeholder-text');
                }
            }
        }
    }
    
    const titleEl = document.getElementById("mainTitle");
    if (titleEl && mode !== "admin") {
        const title = localStorage.getItem("mainTitle") || "Pikado";
        titleEl.textContent = title;
    }
}

function renderAutomats() {
    const container = document.getElementById("automatsContainer");
    container.innerHTML = "";

    for (let i = 1; i <= automats; i++) {
        const indexA = (i - 1) * 2 + 1;
        const indexB = indexA + 1;

        const nameKey = `automat_name_${i}`;
        const automatName = localStorage.getItem(nameKey) || `Avtomat ${i}`;

        const html = document.createElement("div");
        html.classList.add("column", "add-animation");

        if (mode !== "admin") {
            const nameA = localStorage.getItem(`v${indexA}`) || "";
            const nameB = localStorage.getItem(`v${indexB}`) || "";
            
            html.innerHTML = `
                <div class="automat-name-display" id="name_${i}">${automatName}</div>
                <div class="player-display ${!nameA ? 'placeholder-text' : ''}" id="v${indexA}">${nameA || "Igralec 1"}</div>
                <div class="player-display ${!nameB ? 'placeholder-text' : ''}" id="v${indexB}">${nameB || "Igralec 2"}</div>
            `;
        } else {
            html.innerHTML = `
                <input class="automat-name" id="name_${i}" value="${automatName}" />
                <textarea id="v${indexA}" placeholder="Igralec 1"></textarea>
                <textarea id="v${indexB}" placeholder="Igralec 2"></textarea>
                <button onclick="novPar(${i})" id="btn_${i}">PRENESI PAR</button>
            `;
        }

        container.appendChild(html);

        setTimeout(() => html.classList.add("show"), 20);
    }

    if (mode === "admin") {
        loadValues();
        document.querySelectorAll('button').forEach(b => b.style.display = 'inline-block');

        document.querySelectorAll('.automat-name').forEach((input, idx) => {
            const index = idx + 1;
            const debouncedSave = debounce(() => {
                localStorage.setItem(`automat_name_${index}`, input.value);
                localStorage.setItem('lastUpdateTime', Date.now().toString());
            }, 1000);
            input.addEventListener("input", debouncedSave);
        });

        document.querySelectorAll('textarea').forEach(textarea => {
            const debouncedSave = debounce(() => {
                const id = textarea.id;
                localStorage.setItem(id, textarea.value);
                localStorage.setItem('lastUpdateTime', Date.now().toString());
            }, 1000);
            textarea.addEventListener("input", debouncedSave);
        });

        const ctrl = document.getElementById("adminControls");
        if (ctrl) ctrl.style.display = "block";
        document.getElementById('adminPanel').style.display = 'block';
    } else {
        loadDisplayValues();
    }
}

window.onload = () => {
    renderAutomats();
    
    if (mode !== "admin") {
        const nextSection = document.querySelector('.next-section');
        if (nextSection) {
            const textareas = nextSection.querySelectorAll('textarea');
            textareas.forEach(textarea => {
                const textEl = document.createElement("div");
                textEl.id = textarea.id;
                textEl.className = "player-display";
                const saved = localStorage.getItem(textarea.id);
                if (!saved) {
                    textEl.classList.add('placeholder-text');
                }
                textEl.textContent = saved || textarea.placeholder || "";
                textarea.parentNode.replaceChild(textEl, textarea);
            });
        }
    } else {
        const nextSection = document.querySelector('.next-section');
        if (nextSection) {
            const textareas = nextSection.querySelectorAll('textarea');
            textareas.forEach(textarea => {
                const debouncedSave = debounce(() => {
                    const id = textarea.id;
                    localStorage.setItem(id, textarea.value);
                    localStorage.setItem('lastUpdateTime', Date.now().toString());
                }, 1000);
                textarea.addEventListener("input", debouncedSave);
            });
        }
    }
    
    startSyncBehavior();
};

function addAvtomat() {
    automats++;
    localStorage.setItem("automats", automats);
    localStorage.setItem('lastUpdateTime', Date.now().toString());
    renderAutomats();
}

function removeAvtomat() {
    if (automats === 1) return alert("Mora ostati vsaj 1 avtomat!");

    const nameKey = `automat_name_${automats}`;
    localStorage.removeItem(nameKey);

    const idA = `v${(automats - 1) * 2 + 1}`;
    const idB = `v${(automats - 1) * 2 + 2}`;
    localStorage.removeItem(idA);
    localStorage.removeItem(idB);

    automats--;
    localStorage.setItem("automats", automats);
    localStorage.setItem('lastUpdateTime', Date.now().toString());
    
    renderAutomats();
}

function playSound() {
    try {
        const audio = new Audio('sounds/sound.mp3');
        audio.play().catch(err => {
            console.log('Sound could not be played:', err);
        });
    } catch (err) {
        console.log('Sound error:', err);
    }
}

function novPar(stolpec) {
    const btn = document.getElementById(`btn_${stolpec}`);
    
    if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
        
        setTimeout(() => {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
        }, 1000);
    }
    
    const vA = `v${(stolpec - 1) * 2 + 1}`;
    const vB = `v${(stolpec - 1) * 2 + 2}`;

    const next1 = document.getElementById('v7').value.trim();
    const next2 = document.getElementById('v8').value.trim();

    if (!next1 && !next2) {
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
        }
        return alert("Vnesi naslednji par pred prenosom!");
    }
    
    playSound();

    const prev1 = document.getElementById(vA).value;
    const prev2 = document.getElementById(vB).value;

    document.getElementById(vA).value = next1;
    document.getElementById(vB).value = next2;

    document.getElementById("v7").value = document.getElementById("v9").value;
    document.getElementById("v8").value = document.getElementById("v10").value;
    document.getElementById("v9").value = "";
    document.getElementById("v10").value = "";

    for (let i = 1; i <= automats * 2 + 10; i++) {
        const el = document.getElementById(`v${i}`);
        if (el) localStorage.setItem(`v${i}`, el.value);
    }

    const now = new Date().toLocaleString("sl-SI");
    const name = localStorage.getItem(`automat_name_${stolpec}`) || `Avtomat ${stolpec}`;
    log.push(`${now} - ${name}: (${prev1 || "-"}, ${prev2 || "-"}) → (${next1 || "-"}, ${next2 || "-"})`);
    localStorage.setItem("log", JSON.stringify(log));
    
    localStorage.setItem('lastUpdateTime', Date.now().toString());
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
    if (!confirm('Res želiš izbrisati zgodovino?')) return;
    log = [];
    localStorage.removeItem('log');
    showHistory();
}

function startSyncBehavior() {
    if (mode === 'admin') {
    } else {
        window.addEventListener('storage', e => {
            if (e.key === 'lastUpdateTime' || e.key === 'automats') {
                if (e.key === 'automats') {
                    const newAutomats = parseInt(localStorage.getItem('automats') || '1');
                    if (newAutomats !== automats) {
                        automats = newAutomats;
                        renderAutomats();
                        const nextSection = document.querySelector('.next-section');
                        if (nextSection) {
                            const textareas = nextSection.querySelectorAll('textarea');
                            textareas.forEach(textarea => {
                                const textEl = document.createElement("div");
                                textEl.id = textarea.id;
                                textEl.className = "player-display";
                                const saved = localStorage.getItem(textarea.id);
                                if (!saved) {
                                    textEl.classList.add('placeholder-text');
                                }
                                textEl.textContent = saved || textarea.placeholder || "";
                                textarea.parentNode.replaceChild(textEl, textarea);
                            });
                        }
                    }
                } else {
                    loadDisplayValues();
                }
            } else if (e.key && (e.key.startsWith('v') || e.key.startsWith('automat_name_') || e.key === 'mainTitle')) {
                loadDisplayValues();
            }
        });
        
        window.addEventListener('localStorageChange', () => {
            loadDisplayValues();
        });
        
        let lastUpdateTime = localStorage.getItem('lastUpdateTime');
        let lastAutomats = parseInt(localStorage.getItem('automats') || '1');
        setInterval(() => {
            const currentUpdateTime = localStorage.getItem('lastUpdateTime');
            const currentAutomats = parseInt(localStorage.getItem('automats') || '1');
            
            if (currentAutomats !== lastAutomats) {
                lastAutomats = currentAutomats;
                automats = currentAutomats;
                renderAutomats();
                const nextSection = document.querySelector('.next-section');
                if (nextSection) {
                    const textareas = nextSection.querySelectorAll('textarea');
                    textareas.forEach(textarea => {
                        const textEl = document.createElement("div");
                        textEl.id = textarea.id;
                        textEl.className = "player-display";
                        const saved = localStorage.getItem(textarea.id);
                        textEl.textContent = saved || textarea.placeholder || "";
                        textarea.parentNode.replaceChild(textEl, textarea);
                    });
                }
            } else if (currentUpdateTime !== lastUpdateTime) {
                lastUpdateTime = currentUpdateTime;
                loadDisplayValues();
            }
        }, 100);
    }
}