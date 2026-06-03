(function () {
  'use strict';

  // Read config from script tag attributes
  const scripts = document.querySelectorAll('script[data-token]');
  const currentScript = scripts[scripts.length - 1];
  if (!currentScript) return;

  const WIDGET_TOKEN = currentScript.getAttribute('data-token') || '';
  const AGENT_NAME = currentScript.getAttribute('data-name') || 'Assistant IA';
  const AGENT_COLOR = currentScript.getAttribute('data-color') || '#6366f1';
  const API_BASE = currentScript.src.replace('/widget.js', '');

  if (!WIDGET_TOKEN) {
    console.warn('[ASSOCIE.AI Widget] Aucun data-token fourni.');
    return;
  }

  // Inject styles
  const style = document.createElement('style');
  style.textContent = `
    #associe-widget-btn {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: ${AGENT_COLOR};
      color: #fff;
      border: none;
      cursor: pointer;
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.25);
      transition: transform 0.2s, box-shadow 0.2s;
      font-size: 22px;
    }
    #associe-widget-btn:hover {
      transform: scale(1.1);
      box-shadow: 0 8px 32px rgba(0,0,0,0.35);
    }
    #associe-widget-panel {
      position: fixed;
      bottom: 92px;
      right: 24px;
      width: 360px;
      max-width: calc(100vw - 48px);
      height: 500px;
      max-height: calc(100vh - 120px);
      background: #0f0f11;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      box-shadow: 0 16px 64px rgba(0,0,0,0.5);
      display: flex;
      flex-direction: column;
      z-index: 999998;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      transition: opacity 0.25s, transform 0.25s;
    }
    #associe-widget-panel.hidden {
      opacity: 0;
      pointer-events: none;
      transform: translateY(12px) scale(0.97);
    }
    .associe-header {
      padding: 14px 16px;
      background: ${AGENT_COLOR};
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
    .associe-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: rgba(255,255,255,0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 13px;
      color: #fff;
      flex-shrink: 0;
    }
    .associe-header-info { flex: 1 }
    .associe-header-name {
      font-size: 14px;
      font-weight: 600;
      color: #fff;
      line-height: 1;
    }
    .associe-header-status {
      font-size: 10px;
      color: rgba(255,255,255,0.7);
      margin-top: 2px;
    }
    .associe-close-btn {
      background: none;
      border: none;
      color: rgba(255,255,255,0.7);
      cursor: pointer;
      padding: 4px;
      font-size: 18px;
      line-height: 1;
      border-radius: 4px;
      transition: color 0.15s;
    }
    .associe-close-btn:hover { color: #fff; }
    .associe-messages {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.1) transparent;
    }
    .associe-msg {
      max-width: 85%;
      padding: 10px 13px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.55;
      word-break: break-word;
    }
    .associe-msg.user {
      background: ${AGENT_COLOR};
      color: #fff;
      margin-left: auto;
      border-bottom-right-radius: 4px;
    }
    .associe-msg.ai {
      background: rgba(255,255,255,0.06);
      color: #e5e7eb;
      border-bottom-left-radius: 4px;
    }
    .associe-msg.typing {
      background: rgba(255,255,255,0.06);
      color: #9ca3af;
      font-style: italic;
    }
    .associe-msg a { color: ${AGENT_COLOR}; }
    .associe-form {
      display: flex;
      gap: 8px;
      padding: 12px;
      border-top: 1px solid rgba(255,255,255,0.06);
      background: rgba(255,255,255,0.02);
      flex-shrink: 0;
    }
    .associe-input {
      flex: 1;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      color: #f3f4f6;
      font-size: 13px;
      padding: 9px 13px;
      outline: none;
      resize: none;
      font-family: inherit;
    }
    .associe-input:focus { border-color: ${AGENT_COLOR}; }
    .associe-input::placeholder { color: rgba(255,255,255,0.25); }
    .associe-send-btn {
      background: ${AGENT_COLOR};
      border: none;
      border-radius: 10px;
      color: #fff;
      cursor: pointer;
      padding: 9px 14px;
      font-size: 16px;
      transition: opacity 0.15s;
      flex-shrink: 0;
    }
    .associe-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .associe-powered {
      text-align: center;
      font-size: 10px;
      color: rgba(255,255,255,0.2);
      padding: 4px 12px 8px;
    }
    .associe-powered a { color: rgba(255,255,255,0.35); text-decoration: none; }
  `;
  document.head.appendChild(style);

  // Build HTML
  const panel = document.createElement('div');
  panel.id = 'associe-widget-panel';
  panel.classList.add('hidden');
  panel.innerHTML = `
    <div class="associe-header">
      <div class="associe-avatar">${AGENT_NAME.charAt(0).toUpperCase()}</div>
      <div class="associe-header-info">
        <div class="associe-header-name">${AGENT_NAME}</div>
        <div class="associe-header-status">● En ligne</div>
      </div>
      <button class="associe-close-btn" id="associe-close">✕</button>
    </div>
    <div class="associe-messages" id="associe-msgs">
      <div class="associe-msg ai">Bonjour ! 👋 Je suis <strong>${AGENT_NAME}</strong>. Comment puis-je vous aider aujourd'hui ?</div>
    </div>
    <form class="associe-form" id="associe-form">
      <textarea class="associe-input" id="associe-input" placeholder="Posez votre question..." rows="1"></textarea>
      <button class="associe-send-btn" type="submit" id="associe-send">➤</button>
    </form>
    <div class="associe-powered">Propulsé par <a href="https://associe.ai" target="_blank">ASSOCIE.AI</a></div>
  `;

  const btn = document.createElement('button');
  btn.id = 'associe-widget-btn';
  btn.title = `Ouvrir ${AGENT_NAME}`;
  btn.innerHTML = '💬';

  document.body.appendChild(panel);
  document.body.appendChild(btn);

  // Toggle panel
  let isOpen = false;
  function togglePanel() {
    isOpen = !isOpen;
    panel.classList.toggle('hidden', !isOpen);
    btn.innerHTML = isOpen ? '✕' : '💬';
    if (isOpen) document.getElementById('associe-input').focus();
  }

  btn.addEventListener('click', togglePanel);
  document.getElementById('associe-close').addEventListener('click', togglePanel);

  // Auto-resize textarea
  const input = document.getElementById('associe-input');
  input.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 100) + 'px';
  });

  // Submit on Enter (Shift+Enter for new line)
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('associe-form').dispatchEvent(new Event('submit'));
    }
  });

  // Send message
  document.getElementById('associe-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const question = input.value.trim();
    if (!question) return;

    const msgs = document.getElementById('associe-msgs');
    const sendBtn = document.getElementById('associe-send');

    // User bubble
    const userBubble = document.createElement('div');
    userBubble.className = 'associe-msg user';
    userBubble.textContent = question;
    msgs.appendChild(userBubble);

    // Typing indicator
    const typingBubble = document.createElement('div');
    typingBubble.className = 'associe-msg typing';
    typingBubble.textContent = `${AGENT_NAME} est en train d'écrire...`;
    msgs.appendChild(typingBubble);

    input.value = '';
    input.style.height = 'auto';
    sendBtn.disabled = true;
    msgs.scrollTop = msgs.scrollHeight;

    try {
      const response = await fetch(`${API_BASE}/api/widget/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Widget-Token': WIDGET_TOKEN
        },
        body: JSON.stringify({ question })
      });

      const data = await response.json();
      typingBubble.remove();

      const aiBubble = document.createElement('div');
      aiBubble.className = 'associe-msg ai';
      aiBubble.innerHTML = data.answer
        ? data.answer.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        : 'Je suis désolé, je n\'ai pas pu traiter votre demande.';
      msgs.appendChild(aiBubble);
    } catch (err) {
      typingBubble.remove();
      const errBubble = document.createElement('div');
      errBubble.className = 'associe-msg ai';
      errBubble.textContent = 'Erreur de connexion. Veuillez réessayer.';
      msgs.appendChild(errBubble);
    }

    sendBtn.disabled = false;
    msgs.scrollTop = msgs.scrollHeight;
  });
})();
