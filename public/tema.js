// Aplica o tema salvo antes de desenhar a página (evita "piscar" de claro para escuro).
try { document.documentElement.dataset.tema = localStorage.getItem('tema') || 'auto'; } catch (e) { /* sem armazenamento */ }
